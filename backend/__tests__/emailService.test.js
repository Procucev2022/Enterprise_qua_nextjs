const {
  generateStandardRFQEmail,
  generateVendorOnboardingEmail,
  getPublicFrontendUrl,
  getLogoUrl,
} = require('../src/services/emailService');

const VENDOR_EMAIL_REQUIRED = 'The vendor has no email address on record. Add one before this email can be sent.';
const RFQ_NUMBER_REQUIRED = 'An RFQ number is required to generate the RFQ invitation email.';

describe('Email Template Generation Service', () => {
  test('generateStandardRFQEmail generates formatted email payload', () => {
    const rfq = {
      rfqNumber: 'RFQ-2026-0891',
      title: 'Pumps & Accessories',
      category: 'Mechanical',
      deadline: '2026-09-15',
      lineItems: [
        { itemName: 'Impeller SS316', quantity: 10, technicalSpecs: 'DIN Standard' },
      ],
    };
    const vendor = {
      name: 'Test Industrial Co',
      contactPerson: 'Test Contact',
      email: 'contact@supplier.test',
    };

    const payload = generateStandardRFQEmail(rfq, vendor);
    expect(payload.to).toBe('contact@supplier.test');
    expect(payload.subject).toContain('RFQ-2026-0891');
    expect(payload.htmlBody).toContain('Impeller SS316');
    expect(payload.htmlBody).toContain('DIN Standard');
    expect(payload).not.toHaveProperty('error');
  });

  test('generateStandardRFQEmail reads line items from the canonical extractedEntities field, with budget and attachments', () => {
    const rfq = {
      rfqNumber: 'RFQ-2026-1902',
      title: 'Steel Bottle RFQ Requirement',
      category: 'Mechanical',
      deadline: '2026-09-20',
      budget: 250000,
      attachments: [{ id: 'a1', fileName: 'boq.pdf', size: 1024 }],
      extractedEntities: [
        {
          itemName: 'Steel Bottle',
          quantity: 500,
          unit: 'Nos',
          technicalSpecs: 'IS 3177 Grade A',
          minorCategory: 'Pressure Vessels',
          confidence: 0.92,
        },
      ],
    };
    const vendor = {
      name: 'Test Vendor Supplies',
      contactPerson: 'Test Vendor Contact',
      email: 'vendor.two@supplier.test',
    };

    const payload = generateStandardRFQEmail(rfq, vendor);
    expect(payload.htmlBody).toContain('Steel Bottle');
    expect(payload.htmlBody).toContain('500 Nos');
    expect(payload.htmlBody).toContain('IS 3177 Grade A');
    expect(payload.htmlBody).toContain('Pressure Vessels');
    expect(payload.htmlBody).toContain('AI confidence: 92%');
    expect(payload.htmlBody).toContain('₹2,50,000');
    expect(payload.htmlBody).toContain('boq.pdf');
    // extractedEntities takes precedence over a legacy lineItems key when both exist
    expect(payload.htmlBody).not.toContain('legacy-should-not-render');
  });

  test('generateStandardRFQEmail withholds the recipient when the vendor has no email and shows "Not specified" for absent fields', () => {
    const rfq = {
      rfqNumber: 'RFQ-2026-0002',
      title: 'Untitled requirement',
    };

    const payload = generateStandardRFQEmail(rfq, null);
    expect(payload.to).toBeNull();
    expect(payload.error).toBe(VENDOR_EMAIL_REQUIRED);
    expect(payload.recipientName).toBe('Not specified');
    expect(payload.vendorName).toBe('Not specified');
    expect(payload.htmlBody).toContain('color: #dc2626; font-weight: bold;">Not specified</td>');
    expect(payload.htmlBody).toContain('No line items are recorded for this RFQ.');
    expect(payload.htmlBody).not.toContain('See attached procurement specifications document.');
    expect(payload.htmlBody).toMatch(/Indicative Budget:<\/td>\s*<td style="padding: 8px 12px;">Not specified<\/td>/);
    expect(payload.htmlBody).not.toContain('₹0');
    expect(payload.htmlBody).not.toContain('Supporting Documents');
    expect(payload.htmlBody).not.toContain('Valued Buyer');
  });

  test('generateStandardRFQEmail shows the budget as "Not specified" when it is zero, blank or non-numeric', () => {
    const vendor = { name: 'Budget Vendor', contactPerson: 'Budget Contact', email: 'budget.vendor@supplier.test' };

    [undefined, null, '', 0, 'not-a-number'].forEach((budget) => {
      const payload = generateStandardRFQEmail({ rfqNumber: 'RFQ-BUDGET-0', budget }, vendor);
      expect(payload.htmlBody).toMatch(/Indicative Budget:<\/td>\s*<td style="padding: 8px 12px;">Not specified<\/td>/);
      expect(payload.htmlBody).not.toContain('₹0');
    });
  });

  test('generateStandardRFQEmail formats a numeric string budget with Indian digit grouping', () => {
    const payload = generateStandardRFQEmail(
      { rfqNumber: 'RFQ-BUDGET-1', budget: '150000' },
      { name: 'Budget Vendor', email: 'budget.vendor@supplier.test' }
    );
    expect(payload.htmlBody).toMatch(/Indicative Budget:<\/td>\s*<td style="padding: 8px 12px;">₹1,50,000<\/td>/);
  });

  test('generateStandardRFQEmail shows "Not specified" for missing line-item fields instead of invented defaults', () => {
    const rfq = {
      rfqNumber: 'RFQ-SPARSE-1',
      title: 'Sparse RFQ',
      extractedEntities: [{}, { description: 'Fallback Description' }],
    };

    const payload = generateStandardRFQEmail(rfq, {});
    expect(payload.to).toBeNull();
    expect(payload.htmlBody).toContain('1. Not specified');
    expect(payload.htmlBody).toContain('2. Fallback Description');
    expect(payload.htmlBody).not.toContain('1 Units');
    expect(payload.htmlBody).not.toContain('Standard Enterprise Specification');
  });

  test('generateStandardRFQEmail throws without an RFQ number and shows "Not specified" for an unnamed attachment', () => {
    expect(() => generateStandardRFQEmail({ title: 'No RFQ number' }, { name: 'Vendor Only' })).toThrow(RFQ_NUMBER_REQUIRED);

    const payload = generateStandardRFQEmail(
      {
        rfqNumber: 'RFQ-NAME-1',
        title: 'Named attachments',
        attachments: [{ id: 'a1', name: 'legacy-name.pdf' }, { id: 'a2' }],
      },
      { name: 'Vendor Only', email: 'vendor-only@vendor.test' }
    );
    expect(payload.rfqNumber).toBe('RFQ-NAME-1');
    expect(payload.to).toBe('vendor-only@vendor.test');
    expect(payload.htmlBody).toContain('legacy-name.pdf');
    expect(payload.htmlBody).toContain('<li style="margin-bottom: 4px;">Not specified</li>');
  });

  test('generateVendorOnboardingEmail preview omits credentials and gives safe sign-in guidance', () => {
    const vendor = {
      name: 'Precision Hydraulics',
      contactPerson: 'Sanjay',
      email: 'sanjay@hydro.com',
    };

    const payload = generateVendorOnboardingEmail(vendor);
    expect(payload.to).toBe('sanjay@hydro.com');
    expect(payload.subject).toContain('Onboarding');
    expect(payload).not.toHaveProperty('tempPassword');
    expect(payload.htmlBody).toContain('follow the verification steps shown on the portal');
    expect(payload.htmlBody).not.toContain('Temporary Password');
  });

  test('generateVendorOnboardingEmail shows "Not specified" for a missing contact without inventing credentials', () => {
    const vendor = { name: 'No Contact Vendor', email: 'nocontact@vendor.com' };

    const payload = generateVendorOnboardingEmail(vendor);
    expect(payload.recipientName).toBe('Not specified');
    expect(payload.htmlBody).toContain('>Not specified<');
    expect(payload).not.toHaveProperty('tempPassword');
    expect(payload.htmlBody).not.toContain('Procucev#2026!Vendor');
  });

  test('generateVendorOnboardingEmail withholds the recipient when the vendor has no email', () => {
    const payload = generateVendorOnboardingEmail({ name: 'Email Missing Vendor' });
    expect(payload.to).toBeNull();
    expect(payload.error).toBe(VENDOR_EMAIL_REQUIRED);
    expect(payload.htmlBody).toContain('<strong>Not specified</strong>');
  });

  test('generateStandardRFQEmail and generateVendorOnboardingEmail render real procucev logo and dynamic URLs', () => {
    process.env.PUBLIC_FRONTEND_URL = 'https://procucev-enterprise-frontend.procucev-enterprise.workers.dev';

    const rfq = { rfqNumber: 'RFQ-TEST-DYNAMIC-99', title: 'Test Dynamic RFQ' };
    const vendor = { name: 'Acme Test', email: 'acme@test.com' };

    const rfqPayload = generateStandardRFQEmail(rfq, vendor);
    expect(rfqPayload.htmlBody).toContain('procucev-logo.png');
    expect(rfqPayload.htmlBody).toContain('alt="Procucev Enterprise"');
    expect(rfqPayload.htmlBody).toContain('https://procucev-enterprise-frontend.procucev-enterprise.workers.dev/vendor/quotation-form?rfq=RFQ-TEST-DYNAMIC-99');

    const onboardPayload = generateVendorOnboardingEmail(vendor);
    expect(onboardPayload.htmlBody).toContain('procucev-logo.png');
    expect(onboardPayload.htmlBody).toContain('https://procucev-enterprise-frontend.procucev-enterprise.workers.dev/login');

    delete process.env.PUBLIC_FRONTEND_URL;
  });

  test('getPublicFrontendUrl and getLogoUrl handle fallbacks and Cloudflare environment', () => {
    delete process.env.APP_PUBLIC_URL;
    delete process.env.FRONTEND_URL;
    delete process.env.PUBLIC_FRONTEND_URL;

    globalThis.__CF_ENV__ = { PUBLIC_FRONTEND_URL: 'https://cf-test-frontend.workers.dev/' };
    expect(getPublicFrontendUrl()).toBe('https://cf-test-frontend.workers.dev');
    expect(getLogoUrl()).toBe('https://cf-test-frontend.workers.dev/procucev-logo.png');
    delete globalThis.__CF_ENV__;
  });

  test('getPublicFrontendUrl returns the configured URL unchanged, with no domain-specific rewrite', () => {
    const origNodeEnv = process.env.NODE_ENV;
    process.env.PUBLIC_FRONTEND_URL = 'https://configured-frontend.example.test/';

    process.env.NODE_ENV = 'production';
    expect(getPublicFrontendUrl()).toBe('https://configured-frontend.example.test');

    process.env.NODE_ENV = 'test';
    globalThis.__CF_ENV__ = { ENVIRONMENT: 'prod' };
    expect(getPublicFrontendUrl()).toBe('https://configured-frontend.example.test');

    delete globalThis.__CF_ENV__;
    delete process.env.PUBLIC_FRONTEND_URL;
    process.env.NODE_ENV = 'production';
    expect(getPublicFrontendUrl()).toBe('https://equa.procucev.com');

    process.env.NODE_ENV = 'test';
    globalThis.__CF_ENV__ = { NODE_ENV: 'production' };
    expect(getPublicFrontendUrl()).toBe('https://equa.procucev.com');

    delete globalThis.__CF_ENV__;
    process.env.NODE_ENV = origNodeEnv;
  });

  test('generateStandardRFQEmail and generateVendorOnboardingEmail produce responsive full-width layouts', () => {
    const rfqPayload = generateStandardRFQEmail({ rfqNumber: 'RFQ-RESP-01', title: 'Test' }, {});
    expect(rfqPayload.htmlBody).toContain('max-width: 100%');
    expect(rfqPayload.htmlBody).toContain('width: 100%');
    expect(rfqPayload.htmlBody).toContain('background-color: #ffffff');
    expect(rfqPayload.htmlBody).toContain('box-sizing: border-box');
    expect(rfqPayload.htmlBody).toContain('role="presentation"');
    expect(rfqPayload.htmlBody).toContain('class="email-wrapper"');

    const vendorPayload = generateVendorOnboardingEmail({ name: 'Acme', email: 'test@acme.com' });
    expect(vendorPayload.htmlBody).toContain('max-width: 100%');
    expect(vendorPayload.htmlBody).toContain('width: 100%');
    expect(vendorPayload.htmlBody).toContain('background-color: #ffffff');
    expect(vendorPayload.htmlBody).toContain('box-sizing: border-box');
    expect(vendorPayload.htmlBody).toContain('role="presentation"');
  });
});
