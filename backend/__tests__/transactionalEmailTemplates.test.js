/**
 * Unit Test Suite for Qua AI Transactional Email Templates (13 Templates)
 * Enforces >= 90% benchmark on Statements, Branches, Functions, and Lines.
 */

const {
  escapeHtml,
  resolveSalutation,
  wrapQuaAiEmail,
  renderCtaButton,
  buildEmail1_RfqCreatedAccountAutoCreated,
  buildEmail2_RfqCreated,
  buildEmail3_NewRfqIntimation,
  buildEmail4_NewRfqToQuote,
  buildEmail5_QuotationsReadyToCompare,
  buildEmail6_ActivateYourAccount,
  buildEmail7_RfqNeedsMoreInformation,
  buildEmail8_NoQuotesYet,
  buildEmail9_QuoteDeadlineReminder,
  buildEmail10_LowOrZeroCredits,
  buildEmail11_QuoteSubmitted,
  buildEmail12_RfqRevisedBuyerQuestion,
  buildEmail13_CompleteYourProfile,
  renderTransactionalEmail,
  getAllTransactionalEmailTemplates,
  sendTransactionalEmail,
  resolveTemplateKey,
  getPublicFrontendUrl,
  getLogoUrl,
  TEMPLATE_REGISTRY,
  TEMPLATE_ALIASES,
} = require('../src/services/transactionalEmailTemplates');

const { QUA_AI_EMAIL_TEMPLATES, QUA_AI_EMAIL_SUPPORT } = require('../src/config/constants');
const mailerService = require('../src/services/mailerService');

describe('Qua AI Transactional Email Templates Suite', () => {
  describe('Helper Utilities', () => {
    test('escapeHtml handles strings and falsy inputs', () => {
      expect(escapeHtml(null)).toBe('');
      expect(escapeHtml(undefined)).toBe('');
      expect(escapeHtml('<script>alert("xss")&"test"\'</script>')).toBe(
        '&lt;script&gt;alert(&quot;xss&quot;)&amp;&quot;test&quot;&#39;&lt;/script&gt;'
      );
      expect(escapeHtml(12345)).toBe('12345');
    });

    test('resolveSalutation prioritizes firstName and falls back gracefully', () => {
      expect(resolveSalutation('Rajesh')).toBe('Rajesh');
      expect(resolveSalutation('   Priya   ')).toBe('Priya');
      expect(resolveSalutation('', 'there')).toBe('there');
      expect(resolveSalutation(null)).toBe('there');
      expect(resolveSalutation(undefined, 'valued partner')).toBe('valued partner');
    });

    test('renderCtaButton generates valid markup with custom or default URL', () => {
      const btn1 = renderCtaButton('Click Here', 'https://example.com/target');
      expect(btn1).toContain('https://example.com/target');
      expect(btn1).toContain('Click Here');

      const btn2 = renderCtaButton('Default Action');
      expect(btn2).toContain('Default Action');
      expect(btn2).toContain('http');
    });

    test('wrapQuaAiEmail wraps content with Qua AI header, footer, and branding', () => {
      const html = wrapQuaAiEmail({
        title: 'Custom Test Email',
        innerHtml: '<p>Test inner content</p>',
      });
      expect(html).toContain('Custom Test Email');
      expect(html).toContain('Test inner content');
      expect(html).toContain('QUA AI 2.0');
      expect(html).toContain(QUA_AI_EMAIL_SUPPORT.PHONE);
      expect(html).toContain(QUA_AI_EMAIL_SUPPORT.EMAIL);
      expect(html).toContain(QUA_AI_EMAIL_SUPPORT.TEAM_SIGNATURE);
      expect(html).toContain(QUA_AI_EMAIL_SUPPORT.COMPANY_NAME);
    });

    test('resolveTemplateKey resolves canonical keys, numbers, and aliases', () => {
      expect(resolveTemplateKey('EMAIL_1_RFQ_CREATED_ACCOUNT_AUTO_CREATED')).toBe('EMAIL_1_RFQ_CREATED_ACCOUNT_AUTO_CREATED');
      expect(resolveTemplateKey('email_1_rfq_created_account_auto_created')).toBe('EMAIL_1_RFQ_CREATED_ACCOUNT_AUTO_CREATED');
      expect(resolveTemplateKey(1)).toBe('EMAIL_1_RFQ_CREATED_ACCOUNT_AUTO_CREATED');
      expect(resolveTemplateKey('1')).toBe('EMAIL_1_RFQ_CREATED_ACCOUNT_AUTO_CREATED');
      expect(resolveTemplateKey('email_1')).toBe('EMAIL_1_RFQ_CREATED_ACCOUNT_AUTO_CREATED');
      expect(resolveTemplateKey('rfq_created_account_auto_created')).toBe('EMAIL_1_RFQ_CREATED_ACCOUNT_AUTO_CREATED');
      expect(resolveTemplateKey(2)).toBe('EMAIL_2_RFQ_CREATED');
      expect(resolveTemplateKey('rfq_created')).toBe('EMAIL_2_RFQ_CREATED');
      expect(resolveTemplateKey(13)).toBe('EMAIL_13_COMPLETE_YOUR_PROFILE');
      expect(resolveTemplateKey('non_existent_key')).toBeNull();
      expect(resolveTemplateKey(null)).toBeNull();
    });
  });

  describe('Email 1 : RFQ created from email, account auto-created', () => {
    test('renders with all parameters', () => {
      const result = buildEmail1_RfqCreatedAccountAutoCreated({
        first_name: 'Ananya',
        rfq_id: 'RFQ-9901',
        rfq_title: 'Centrifugal Water Pumps',
        email: 'ananya@acme.com',
        temp_password: 'TempPassword123!',
        login_url: 'https://equa.procucev.com/login',
        review_url: 'https://equa.procucev.com/buyer/rfq/9901',
      });

      expect(result.templateId).toBe('EMAIL_1_RFQ_CREATED_ACCOUNT_AUTO_CREATED');
      expect(result.templateNumber).toBe(1);
      expect(result.who).toBe('Unregistered buyer');
      expect(result.subject).toBe('Congratulations, your RFQ RFQ-9901 is live on Qua AI');
      expect(result.text).toContain('Hi Ananya,');
      expect(result.text).toContain('RFQ-9901 : Centrifugal Water Pumps');
      expect(result.text).toContain('Login ID: ananya@acme.com');
      expect(result.text).toContain('Registered Mobile: 9999999999');
      expect(result.text).toContain('Temporary password: TempPassword123!');
      expect(result.text).toContain('Three quick steps to finish');
      expect(result.text).toContain('Log in & review my RFQ');
      expect(result.html).toContain('Ananya');
      expect(result.html).toContain('RFQ-9901');
      expect(result.html).toContain('Centrifugal Water Pumps');
      expect(result.html).toContain('TempPassword123!');
      expect(result.html).toContain('Registered Mobile:');
      expect(result.html).toContain('9999999999');
    });

    test('falls back safely with empty params', () => {
      const result = buildEmail1_RfqCreatedAccountAutoCreated({});
      expect(result.subject).toContain('RFQ-2026');
      expect(result.text).toContain('Hi there,');
      expect(result.html).toContain('buyer@example.com');
    });
  });

  describe('Email 2 : RFQ created', () => {
    test('renders with custom items and parameters', () => {
      const result = buildEmail2_RfqCreated({
        first_name: 'Suresh',
        rfq_id: 'RFQ-5522',
        rfq_title: 'SS316 Flanges & Fasteners',
        category: 'Piping & Fitting',
        item_count: 2,
        delivery_location: 'Dahej Petrochemical Complex, Gujarat',
        required_by: '2026-11-30',
        quote_deadline: '2026-10-30',
        suppliers_invited: 8,
        items: [
          { item_name: 'Blind Flange 4 inch', item_spec: 'Class 150 ANSI SS316', qty: 20, uom: 'Nos' },
          { item_name: 'Stud Bolts M16x120', item_spec: 'B7/2H HDG', qty: 160, uom: 'Sets' },
        ],
        rfq_summary_url: 'https://equa.procucev.com/buyer/rfq/5522',
      });

      expect(result.templateId).toBe('EMAIL_2_RFQ_CREATED');
      expect(result.subject).toBe('Congratulations, RFQ RFQ-5522 is live. Qua AI is on it');
      expect(result.text).toContain('Hi Suresh,');
      expect(result.text).toContain('8 matched suppliers');
      expect(result.text).toContain('RFQ Summary');
      expect(result.text).toContain('Blind Flange 4 inch');
      expect(result.text).toContain('Stud Bolts M16x120');
      expect(result.html).toContain('Dahej Petrochemical Complex');
      expect(result.html).toContain('Class 150 ANSI SS316');
      expect(result.html).toContain('160');
      expect(result.html).toContain('Sets');
    });

    test('falls back safely when items are not provided', () => {
      const result = buildEmail2_RfqCreated({});
      expect(result.subject).toContain('RFQ-2026');
      expect(result.text).toContain('Hi there,');
      expect(result.html).toContain('Standard Specification');
    });
  });

  describe('Email 3 : New RFQ intimation', () => {
    test('renders for unregistered vendor', () => {
      const result = buildEmail3_NewRfqIntimation({
        first_name: 'Vikas',
        category: 'Electrical Transformers',
        quote_deadline: '2026-11-05 17:00 IST',
        rfq_title: 'Dry Type Step-Down Transformers 500kVA',
        buyer_industry: 'Steel Manufacturing',
        buyer_city: 'Rourkela',
        item_count: 3,
        delivery_location: 'Rourkela Plant Site',
        required_by: '2026-12-15',
        rfq_id: 'RFQ-8811',
        cta_url: 'https://equa.procucev.com/vendor/register?rfq=RFQ-8811',
      });

      expect(result.templateId).toBe('EMAIL_3_NEW_RFQ_INTIMATION');
      expect(result.who).toBe('Unregistered vendor');
      expect(result.subject).toBe('New buyer enquiry for Electrical Transformers: quote by 2026-11-05 17:00 IST');
      expect(result.text).toContain('Hi Vikas,');
      expect(result.text).toContain('Steel Manufacturing company, Rourkela');
      expect(result.text).toContain('Complete profile & quote now');
      expect(result.html).toContain('Rourkela Plant Site');
    });

    test('falls back safely with empty params', () => {
      const result = buildEmail3_NewRfqIntimation({});
      expect(result.subject).toContain('Industrial Supplies');
      expect(result.text).toContain('Hi there,');
      expect(result.html).toContain('Heavy Industrial company, India');
    });
  });

  describe('Email 4 : New RFQ to quote', () => {
    test('renders for registered vendor with credit balance', () => {
      const result = buildEmail4_NewRfqToQuote({
        first_name: 'Pooja',
        rfq_id: 'RFQ-3301',
        rfq_title: 'Hydraulic Valves & Cylinders',
        quote_deadline: '2026-11-02 18:00 IST',
        buyer_industry: 'Automotive EPC',
        buyer_city: 'Pune',
        item_count: 5,
        delivery_location: 'Chakan Industrial Phase II, Pune',
        required_by: '2026-11-25',
        credit_balance: 12,
        quote_url: 'https://equa.procucev.com/vendor/rfq/3301',
      });

      expect(result.templateId).toBe('EMAIL_4_NEW_RFQ_TO_QUOTE');
      expect(result.who).toBe('Registered vendor');
      expect(result.subject).toBe('New RFQ RFQ-3301: Hydraulic Valves & Cylinders, quotes close 2026-11-02 18:00 IST');
      expect(result.text).toContain('Hi Pooja,');
      expect(result.text).toContain('Your credit balance: 12 credits.');
      expect(result.html).toContain('Automotive EPC');
      expect(result.html).toContain('12 credits');
    });

    test('falls back safely with empty params', () => {
      const result = buildEmail4_NewRfqToQuote({});
      expect(result.subject).toContain('RFQ-2026');
      expect(result.text).toContain('Hi there,');
      expect(result.html).toContain('5 credits');
    });
  });

  describe('Email 5 : Quotations ready to compare', () => {
    test('renders quote digest for buyer', () => {
      const result = buildEmail5_QuotationsReadyToCompare({
        first_name: 'Manish',
        quote_count: 4,
        rfq_id: 'RFQ-7740',
        rfq_title: 'Industrial Chillers 50 TR',
        lowest_price: '₹4,50,000',
        fastest_delivery: '10 days',
        compare_url: 'https://equa.procucev.com/buyer/compare/7740',
      });

      expect(result.templateId).toBe('EMAIL_5_QUOTATIONS_READY_TO_COMPARE');
      expect(result.subject).toBe('4 quotes in for RFQ RFQ-7740: compare now');
      expect(result.text).toContain('Hi Manish,');
      expect(result.text).toContain('4 suppliers have quoted on Industrial Chillers 50 TR');
      expect(result.text).toContain('lowest landed price is ₹4,50,000');
      expect(result.text).toContain('fastest delivery is 10 days');
      expect(result.html).toContain('₹4,50,000');
      expect(result.html).toContain('10 days');
    });

    test('falls back safely with empty params', () => {
      const result = buildEmail5_QuotationsReadyToCompare({});
      expect(result.subject).toContain('3 quotes in');
      expect(result.text).toContain('Hi there,');
      expect(result.html).toContain('₹1,25,000');
    });
  });

  describe('Email 6 : Activate your account', () => {
    test('renders profile completion reminder for auto-created buyer', () => {
      const result = buildEmail6_ActivateYourAccount({
        first_name: 'Karan',
        rfq_id: 'RFQ-1102',
        rfq_title: 'Overhead EOT Cranes 10 Ton',
        review_url: 'https://equa.procucev.com/buyer/setup',
      });

      expect(result.templateId).toBe('EMAIL_6_ACTIVATE_YOUR_ACCOUNT');
      expect(result.subject).toBe('Suppliers are waiting on RFQ RFQ-1102');
      expect(result.text).toContain('Hi Karan,');
      expect(result.text).toContain('profile still has placeholder details');
      expect(result.text).toContain('It takes 2 minutes: log in, complete your profile');
      expect(result.html).toContain('Overhead EOT Cranes 10 Ton');
    });

    test('falls back safely with empty params', () => {
      const result = buildEmail6_ActivateYourAccount({});
      expect(result.subject).toContain('RFQ-2026');
      expect(result.text).toContain('Hi there,');
    });
  });

  describe('Email 7 : RFQ needs more information', () => {
    test('renders missing fields list for clarification', () => {
      const result = buildEmail7_RfqNeedsMoreInformation({
        first_name: 'Deepak',
        rfq_id: 'RFQ-6623',
        missing_fields: [
          'Quantity for Item #3 (Control Valves)',
          'Exact delivery site pin code in Raigad',
          'Material test certificate requirements (MTC 3.1)',
        ],
        add_details_url: 'https://equa.procucev.com/buyer/rfq/6623/clarify',
      });

      expect(result.templateId).toBe('EMAIL_7_RFQ_NEEDS_MORE_INFORMATION');
      expect(result.subject).toBe('One detail needed to send RFQ RFQ-6623 to suppliers');
      expect(result.text).toContain('Quantity for Item #3');
      expect(result.text).toContain('Exact delivery site pin code');
      expect(result.html).toContain('Material test certificate requirements');
      expect(result.html).toContain('Add missing details');
    });

    test('falls back to missing_field_1 and missing_field_2 if missing_fields array is absent', () => {
      const result = buildEmail7_RfqNeedsMoreInformation({
        first_name: 'Meera',
        rfq_id: 'RFQ-6624',
        missing_field_1: 'Drawing attachment CAD/PDF',
        missing_field_2: 'Required delivery timeframe',
      });
      expect(result.text).toContain('Drawing attachment CAD/PDF');
      expect(result.text).toContain('Required delivery timeframe');
    });

    test('falls back safely with completely empty params', () => {
      const result = buildEmail7_RfqNeedsMoreInformation({});
      expect(result.subject).toContain('RFQ-2026');
      expect(result.text).toContain('Line item quantity specification');
    });
  });

  describe('Email 8 : No quotes yet', () => {
    test('renders quote deadline extension prompt for buyer', () => {
      const result = buildEmail8_NoQuotesYet({
        first_name: 'Sunita',
        rfq_id: 'RFQ-9912',
        rfq_title: 'Explosion-Proof Motors 75kW',
        extend_url: 'https://equa.procucev.com/buyer/rfq/9912/extend',
      });

      expect(result.templateId).toBe('EMAIL_8_NO_QUOTES_YET');
      expect(result.subject).toBe("RFQ RFQ-9912: let's get you more quotes");
      expect(result.text).toContain('Hi Sunita,');
      expect(result.text).toContain('Suppliers are still reviewing Explosion-Proof Motors 75kW');
      expect(result.text).toContain('Extend deadline / invite more suppliers');
      expect(result.html).toContain('Explosion-Proof Motors 75kW');
    });

    test('falls back safely with empty params', () => {
      const result = buildEmail8_NoQuotesYet({});
      expect(result.subject).toContain('RFQ-2026');
      expect(result.text).toContain('Hi there,');
    });
  });

  describe('Email 9 : Quote deadline reminder', () => {
    test('renders 24-hour reminder to vendor', () => {
      const result = buildEmail9_QuoteDeadlineReminder({
        first_name: 'Rohan',
        rfq_id: 'RFQ-4402',
        rfq_title: 'Seamless Carbon Steel Pipes ASTM A106',
        quote_deadline: 'Tomorrow at 17:00 IST',
        quote_count: 5,
        quote_url: 'https://equa.procucev.com/vendor/rfq/4402',
      });

      expect(result.templateId).toBe('EMAIL_9_QUOTE_DEADLINE_REMINDER');
      expect(result.subject).toBe('24 hours left to quote on Seamless Carbon Steel Pipes ASTM A106');
      expect(result.text).toContain('Hi Rohan,');
      expect(result.text).toContain('RFQ RFQ-4402 closes on Tomorrow at 17:00 IST.');
      expect(result.text).toContain('5 suppliers have already quoted.');
      expect(result.html).toContain('Submit my quote');
    });

    test('falls back safely with empty params', () => {
      const result = buildEmail9_QuoteDeadlineReminder({});
      expect(result.subject).toContain('Procurement Requirement');
      expect(result.text).toContain('Hi there,');
    });
  });

  describe('Email 10 : Low or zero credits', () => {
    test('renders low credits warning and purchase CTA', () => {
      const result = buildEmail10_LowOrZeroCredits({
        first_name: 'Kavita',
        credit_balance: 1,
        matched_rfq_count: 22,
        buy_credits_url: 'https://equa.procucev.com/vendor/billing',
      });

      expect(result.templateId).toBe('EMAIL_10_LOW_OR_ZERO_CREDITS');
      expect(result.subject).toBe("You have 1 credits left: don't miss the next RFQ");
      expect(result.text).toContain('Hi Kavita,');
      expect(result.text).toContain('credit balance is down to 1.');
      expect(result.text).toContain('In the last 30 days, 22 RFQs matched your categories.');
      expect(result.text).toContain('Buy 50 credits');
      expect(result.html).toContain('50 Credits · ₹7,500');
      expect(result.html).toContain('Only ₹150 per RFQ bid');
    });

    test('falls back safely with empty params', () => {
      const result = buildEmail10_LowOrZeroCredits({});
      expect(result.subject).toContain('0 credits left');
      expect(result.text).toContain('Hi there,');
    });
  });

  describe('Email 11 : Quote submitted', () => {
    test('renders quotation receipt confirmation to vendor', () => {
      const result = buildEmail11_QuoteSubmitted({
        first_name: 'Nikhil',
        rfq_id: 'RFQ-8840',
        rfq_title: 'Distribution Panels & Switchgear',
        quote_value: '₹8,45,000',
        quote_deadline: '2026-11-12 18:00 IST',
        view_quote_url: 'https://equa.procucev.com/vendor/quotes/8840',
      });

      expect(result.templateId).toBe('EMAIL_11_QUOTE_SUBMITTED');
      expect(result.subject).toBe('Your quote for RFQ RFQ-8840 has been received');
      expect(result.text).toContain('Hi Nikhil,');
      expect(result.text).toContain('Your quote of ₹8,45,000 for Distribution Panels & Switchgear has reached the buyer.');
      expect(result.text).toContain('View my quote');
      expect(result.html).toContain('₹8,45,000');
      expect(result.html).toContain('2026-11-12 18:00 IST');
    });

    test('falls back safely with empty params', () => {
      const result = buildEmail11_QuoteSubmitted({});
      expect(result.subject).toContain('RFQ-2026');
      expect(result.text).toContain('Hi there,');
    });
  });

  describe('Email 12 : RFQ revised / buyer question', () => {
    test('renders revision alert to participating vendor', () => {
      const result = buildEmail12_RfqRevisedBuyerQuestion({
        first_name: 'Arjun',
        rfq_id: 'RFQ-2910',
        rfq_title: 'Plate Heat Exchangers',
        change_summary: 'Design pressure revised from 10 bar to 16 bar. Quote submission deadline extended by 3 days.',
        quote_deadline: '2026-11-18 18:00 IST',
        review_changes_url: 'https://equa.procucev.com/vendor/rfq/2910/revisions',
      });

      expect(result.templateId).toBe('EMAIL_12_RFQ_REVISED_BUYER_QUESTION');
      expect(result.subject).toBe('Update on RFQ RFQ-2910: please review');
      expect(result.text).toContain('Hi Arjun,');
      expect(result.text).toContain('Design pressure revised from 10 bar to 16 bar');
      expect(result.text).toContain('Review changes');
      expect(result.html).toContain('2026-11-18 18:00 IST');
    });

    test('falls back safely with empty params', () => {
      const result = buildEmail12_RfqRevisedBuyerQuestion({});
      expect(result.subject).toContain('RFQ-2026');
      expect(result.text).toContain('Hi there,');
    });
  });

  describe('Email 13 : Complete your profile', () => {
    test('renders profile completion reminder to unregistered vendor', () => {
      const result = buildEmail13_CompleteYourProfile({
        first_name: 'Divya',
        category: 'Centrifugal Pumps',
        quote_deadline: 'Tomorrow at 18:00 IST',
        buyer_city: 'Ahmedabad',
        rfq_title: 'High-Head Slurry Pumps',
        complete_profile_url: 'https://equa.procucev.com/vendor/profile-setup',
      });

      expect(result.templateId).toBe('EMAIL_13_COMPLETE_YOUR_PROFILE');
      expect(result.subject).toBe('Your RFQ for Centrifugal Pumps closes Tomorrow at 18:00 IST');
      expect(result.text).toContain('Hi Divya,');
      expect(result.text).toContain('buyer in Ahmedabad is still waiting for quotes on High-Head Slurry Pumps');
      expect(result.text).toContain('Complete profile & quote');
      expect(result.html).toContain('Ahmedabad');
    });

    test('falls back safely with empty params', () => {
      const result = buildEmail13_CompleteYourProfile({});
      expect(result.subject).toContain('Industrial Supplies');
      expect(result.text).toContain('Hi there,');
    });
  });

  describe('Universal Dispatcher & Catalog', () => {
    test('getAllTransactionalEmailTemplates returns all 13 template definitions', () => {
      const templates = getAllTransactionalEmailTemplates();
      expect(Array.isArray(templates)).toBe(true);
      expect(templates.length).toBe(13);
      templates.forEach((tmpl, idx) => {
        expect(tmpl.number).toBe(idx + 1);
        expect(tmpl.templateId).toBeTruthy();
        expect(tmpl.name).toBeTruthy();
        expect(tmpl.who).toBeTruthy();
        expect(tmpl.trigger).toBeTruthy();
      });
    });

    test('renderTransactionalEmail renders all 13 templates by index and key', () => {
      for (let i = 1; i <= 13; i++) {
        const renderedNum = renderTransactionalEmail(i, { first_name: 'TestUser' });
        expect(renderedNum.templateNumber).toBe(i);
        expect(renderedNum.subject).toBeTruthy();
        expect(renderedNum.text).toContain('TestUser');
        expect(renderedNum.html).toContain('TestUser');

        const key = Object.keys(TEMPLATE_REGISTRY)[i - 1];
        const renderedKey = renderTransactionalEmail(key, { first_name: 'TestUser' });
        expect(renderedKey.templateId).toBe(key);
      }
    });

    test('renderTransactionalEmail throws on unknown template identifier', () => {
      expect(() => renderTransactionalEmail('non_existent')).toThrow(/Unknown Transactional Email Template/);
      expect(() => renderTransactionalEmail(99)).toThrow(/Unknown Transactional Email Template/);
    });

    test('sendTransactionalEmail routes buyer emails to deliver and vendor emails to deliverVendor', async () => {
      const deliverSpy = jest.spyOn(mailerService, 'deliver').mockResolvedValue({ sent: true, messageId: 'm1' });
      const deliverVendorSpy = jest.spyOn(mailerService, 'deliverVendor').mockResolvedValue({ sent: true, messageId: 'm2' });

      // Buyer email (Email 1)
      const resBuyer = await sendTransactionalEmail('EMAIL_1_RFQ_CREATED_ACCOUNT_AUTO_CREATED', 'buyer@test.com', { first_name: 'Buyer' });
      expect(resBuyer.sent).toBe(true);
      expect(deliverSpy).toHaveBeenCalled();

      // Vendor email (Email 4)
      const resVendor = await sendTransactionalEmail('EMAIL_4_NEW_RFQ_TO_QUOTE', 'vendor@test.com', { first_name: 'Vendor' });
      expect(resVendor.sent).toBe(true);
      expect(deliverVendorSpy).toHaveBeenCalled();

      deliverSpy.mockRestore();
      deliverVendorSpy.mockRestore();
    });
  });

  describe('Frontend and Logo URL Resolution', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...originalEnv };
      delete globalThis.__CF_ENV__;
    });

    test('getPublicFrontendUrl returns localhost by default in test/dev', () => {
      delete process.env.PUBLIC_FRONTEND_URL;
      delete process.env.APP_PUBLIC_URL;
      delete process.env.FRONTEND_URL;
      process.env.NODE_ENV = 'test';

      expect(getPublicFrontendUrl()).toBe('http://localhost:3000');
      expect(getLogoUrl()).toContain('procucev-logo.png');
    });

    test('getPublicFrontendUrl respects production equa domain when srinivas-mukku is configured', () => {
      process.env.PUBLIC_FRONTEND_URL = 'https://srinivas-mukku.workers.dev/';
      process.env.NODE_ENV = 'production';
      expect(getPublicFrontendUrl()).toBe('https://equa.procucev.com');

      process.env.NODE_ENV = 'development';
      globalThis.__CF_ENV__ = { ENVIRONMENT: 'production' };
      expect(getPublicFrontendUrl()).toBe('https://equa.procucev.com');

      globalThis.__CF_ENV__ = { ENVIRONMENT: 'prod' };
      expect(getPublicFrontendUrl()).toBe('https://equa.procucev.com');

      globalThis.__CF_ENV__ = { NODE_ENV: 'production' };
      expect(getPublicFrontendUrl()).toBe('https://equa.procucev.com');
    });

    test('getPublicFrontendUrl trims slashes and returns custom domain', () => {
      process.env.PUBLIC_FRONTEND_URL = 'https://portal.procucev.com///';
      process.env.NODE_ENV = 'development';
      expect(getPublicFrontendUrl()).toBe('https://portal.procucev.com');
      expect(getLogoUrl()).toBe('https://portal.procucev.com/procucev-logo.png');
    });

    test('getPublicFrontendUrl uses production default when NODE_ENV is production without explicit URL', () => {
      delete process.env.PUBLIC_FRONTEND_URL;
      delete process.env.APP_PUBLIC_URL;
      delete process.env.FRONTEND_URL;
      process.env.NODE_ENV = 'production';
      expect(getPublicFrontendUrl()).toBe('https://equa.procucev.com');

      process.env.NODE_ENV = 'development';
      globalThis.__CF_ENV__ = { NODE_ENV: 'production' };
      expect(getPublicFrontendUrl()).toBe('https://equa.procucev.com');
    });

    test('getLogoUrl uses fallback worker asset when localhost or 127.0.0.1 is base', () => {
      process.env.PUBLIC_FRONTEND_URL = 'http://127.0.0.1:3000';
      expect(getLogoUrl()).toContain('procucev-enterprise-frontend.procucev-enterprise.workers.dev');
    });

    test('covers all 13 email builders and wrapQuaAiEmail when called with zero arguments / defaults', () => {
      expect(wrapQuaAiEmail({})).toBeDefined();
      expect(wrapQuaAiEmail({ title: undefined, subtitle: undefined, innerHtml: 'content', supportPhone: undefined, supportEmail: undefined })).toBeDefined();

      expect(buildEmail1_RfqCreatedAccountAutoCreated()).toBeDefined();
      expect(buildEmail2_RfqCreated()).toBeDefined();
      expect(buildEmail2_RfqCreated({ items: [{ item_name: 'Tool', item_spec: 'Steel', qty: 2, uom: 'Nos' }] })).toBeDefined();
      expect(buildEmail2_RfqCreated({ item_count: undefined, items: [] })).toBeDefined();
      expect(buildEmail3_NewRfqIntimation()).toBeDefined();
      expect(buildEmail4_NewRfqToQuote()).toBeDefined();
      expect(buildEmail5_QuotationsReadyToCompare()).toBeDefined();
      expect(buildEmail6_ActivateYourAccount()).toBeDefined();
      expect(buildEmail7_RfqNeedsMoreInformation()).toBeDefined();
      expect(buildEmail7_RfqNeedsMoreInformation({ missing_fields: [] })).toBeDefined();
      expect(buildEmail8_NoQuotesYet()).toBeDefined();
      expect(buildEmail9_QuoteDeadlineReminder()).toBeDefined();
      expect(buildEmail10_LowOrZeroCredits()).toBeDefined();
      expect(buildEmail11_QuoteSubmitted()).toBeDefined();
      expect(buildEmail12_RfqRevisedBuyerQuestion()).toBeDefined();
      expect(buildEmail13_CompleteYourProfile()).toBeDefined();

      // Test alias resolution directly with exact case matching TEMPLATE_ALIASES keys
      expect(resolveTemplateKey('email_1')).toBe('EMAIL_1_RFQ_CREATED_ACCOUNT_AUTO_CREATED');
      expect(resolveTemplateKey('EMAIL_1')).toBe('EMAIL_1_RFQ_CREATED_ACCOUNT_AUTO_CREATED');
    });
  });
});


