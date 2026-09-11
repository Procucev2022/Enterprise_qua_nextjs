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
      name: 'Yagnik Vendor Supplies',
      contactPerson: 'Yagnik C',
      email: 'yagnik.c@ahduni.edu.in',
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

  test('generateStandardRFQEmail falls back to placeholders when line items, budget, attachments, vendor and deadline are absent', () => {
    const rfq = {
      rfqNumber: 'RFQ-2026-0002',
      title: 'Untitled requirement',
    };

    const payload = generateStandardRFQEmail(rfq, null);
    expect(payload.to).toBe('navinchaudhary.dev@gmail.com');
    expect(payload.recipientName).toBe('Procurement Team');
    expect(payload.vendorName).toBe('Preferred Supplier Partner');
    expect(payload.htmlBody).toContain('To be confirmed');
    expect(payload.htmlBody).toContain('See attached procurement specifications document.');
    expect(payload.htmlBody).not.toContain('Indicative Budget');
    expect(payload.htmlBody).not.toContain('Supporting Documents');
  });

  test('generateStandardRFQEmail falls back to item/quantity/unit/description defaults when line items are sparse', () => {
    const rfq = {
      title: 'Sparse RFQ',
      extractedEntities: [{}, { description: 'Fallback Description' }],
    };

    const payload = generateStandardRFQEmail(rfq, {});
    expect(payload.htmlBody).toContain('1. Item');
    expect(payload.htmlBody).toContain('2. Fallback Description');
    expect(payload.htmlBody).toContain('1 Units');
    expect(payload.htmlBody).toContain('Standard Enterprise Specification');
  });

  test('generateStandardRFQEmail falls back to attachment name and RFQ-2026 defaults', () => {
    const rfq = {
      title: 'No RFQ number',
      attachments: [{ id: 'a1', name: 'legacy-name.pdf' }, { id: 'a2' }],
    };

    const payload = generateStandardRFQEmail(rfq, { name: 'Vendor Only' });
    expect(payload.rfqNumber).toBe('RFQ-2026');
    expect(payload.htmlBody).toContain('legacy-name.pdf');
    expect(payload.htmlBody).toContain('Attachment');
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

  test('generateVendorOnboardingEmail falls back to default contactPerson, tempPassword and isExisting flag', () => {
    const vendor = { name: 'No Contact Vendor', email: 'nocontact@vendor.com' };

    const payload = generateVendorOnboardingEmail(vendor, true);
    expect(payload.recipientName).toBe('Vendor Partner');
    expect(payload.htmlBody).toContain('>Partner<');
    expect(payload.tempPassword).toBe('Procucev#2026!Vendor');
    expect(payload.htmlBody).toContain('Procucev#2026!Vendor');
  });
});
