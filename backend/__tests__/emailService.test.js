const {
  generateStandardRFQEmail,
  generateVendorOnboardingEmail,
} = require('../src/services/emailService');

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
      name: 'Apex Industrial Dynamics',
      contactPerson: 'Rajesh Nair',
      email: 'rajesh@apex.in',
    };

    const payload = generateStandardRFQEmail(rfq, vendor);
    expect(payload.to).toBe('rajesh@apex.in');
    expect(payload.subject).toContain('RFQ-2026-0891');
    expect(payload.htmlBody).toContain('Impeller SS316');
    expect(payload.htmlBody).toContain('DIN Standard');
  });

  test('generateVendorOnboardingEmail generates credentials payload', () => {
    const vendor = {
      name: 'Precision Hydraulics',
      contactPerson: 'Sanjay',
      email: 'sanjay@hydro.com',
    };

    const payload = generateVendorOnboardingEmail(vendor, false, 'TempPass#123');
    expect(payload.to).toBe('sanjay@hydro.com');
    expect(payload.subject).toContain('Onboarding');
    expect(payload.htmlBody).toContain('TempPass#123');
  });
});
