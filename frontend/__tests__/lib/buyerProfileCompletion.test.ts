import {
  checkBuyerProfileCompletion,
  PROFILE_SECTIONS,
} from '@/lib/buyerProfileCompletion';
import type { BuyerAccount, BuyerProfile } from '@/lib/types';

describe('checkBuyerProfileCompletion', () => {
  const completeProfile: BuyerProfile = {
    organizationId: 'org-1',
    userId: 'user-1',
    companyName: 'Acme Enterprise Solutions Pvt Ltd',
    brandName: 'Acme',
    organizationType: 'Private Limited',
    panNumber: 'AAACL1234F',
    gstNumber: '27AAACL1234F1Z5',
    cinNumber: 'U12345MH2020PTC123456',
    website: 'https://acme.com',
    annualTurnover: '50-100 Cr',
    street: 'Plot 42, MIDC Industrial Area, Andheri East',
    city: 'Mumbai',
    state: 'Maharashtra',
    pincode: '400093',
    country: 'India',
    contactName: 'Rajesh Sharma',
    contactDesignation: 'Head of Procurement',
    contactEmail: 'rajesh.sharma@acme.com',
    contactPhone: '+91 9876543210',
    categories: [
      { major: 'Mechanical', minor: 'Centrifugal Pumps' },
      { major: 'Electrical', minor: 'Transformers' },
    ],
  };

  it('evaluates a null or undefined profile as completely incomplete', () => {
    const resNull = checkBuyerProfileCompletion(null);
    expect(resNull.isComplete).toBe(false);
    expect(resNull.completionPercentage).toBe(0);
    expect(resNull.completedCount).toBe(0);
    expect(resNull.totalCount).toBe(12);
    expect(resNull.issues).toHaveLength(12);
    expect(resNull.missingSections).toEqual(['organization', 'address', 'contact', 'categories']);
    expect(resNull.completedFields).toEqual([]);

    const resUndefined = checkBuyerProfileCompletion(undefined);
    expect(resUndefined.isComplete).toBe(false);
    expect(resUndefined.issues).toHaveLength(12);
  });

  it('evaluates a 100% complete and valid profile as complete', () => {
    const res = checkBuyerProfileCompletion(completeProfile);
    expect(res.isComplete).toBe(true);
    expect(res.completionPercentage).toBe(100);
    expect(res.completedCount).toBe(12);
    expect(res.totalCount).toBe(12);
    expect(res.issues).toHaveLength(0);
    expect(res.missingSections).toHaveLength(0);
    expect(res.completedFields).toHaveLength(12);
  });

  it('evaluates a BuyerAccount object with supportedMajorCategories and supportedMinorCategories', () => {
    const buyerAccount: Partial<BuyerAccount> = {
      organizationName: 'Tata Steel Limited',
      corporateEmail: 'procurement@tatasteel.com',
      contactPerson: 'Amitabh Sen',
      mobileNumber: '9820012345',
      gstin: '27AAACT1234F1Z1',
      panNumber: 'AAACT1234F',
      street: 'Tata Center, 43 Jawaharlal Nehru Road',
      city: 'Kolkata',
      state: 'West Bengal',
      pincode: '700071',
      supportedMajorCategories: ['Raw Materials'],
      supportedMinorCategories: ['Iron Ore Pellets'],
    };

    const res = checkBuyerProfileCompletion(buyerAccount as any);
    // organizationType is missing on this raw account
    expect(res.isComplete).toBe(false);
    expect(res.issues.some((i) => i.field === 'organizationType')).toBe(true);

    // After setting organizationType
    const completeAcc = { ...buyerAccount, organizationType: 'Public Limited' };
    const resComplete = checkBuyerProfileCompletion(completeAcc as any);
    expect(resComplete.isComplete).toBe(true);
    expect(resComplete.completionPercentage).toBe(100);
    expect(resComplete.issues).toHaveLength(0);
  });

  it('detects missing legal entity name or too short company name', () => {
    const missingName = { ...completeProfile, companyName: '' };
    const res1 = checkBuyerProfileCompletion(missingName);
    expect(res1.isComplete).toBe(false);
    const issue1 = res1.issues.find((i) => i.field === 'companyName');
    expect(issue1?.status).toBe('missing');

    const shortName = { ...completeProfile, companyName: 'A' };
    const res2 = checkBuyerProfileCompletion(shortName);
    expect(res2.isComplete).toBe(false);
    const issue2 = res2.issues.find((i) => i.field === 'companyName');
    expect(issue2?.status).toBe('invalid');
  });

  it('detects missing organization constitution', () => {
    const missingOrgType = { ...completeProfile, organizationType: '' };
    const res = checkBuyerProfileCompletion(missingOrgType);
    expect(res.isComplete).toBe(false);
    const issue = res.issues.find((i) => i.field === 'organizationType');
    expect(issue?.status).toBe('missing');
  });

  it('detects missing or invalid GSTIN format', () => {
    const missingGst = { ...completeProfile, gstNumber: '' };
    const res1 = checkBuyerProfileCompletion(missingGst);
    expect(res1.issues.find((i) => i.field === 'gstNumber')?.status).toBe('missing');

    const invalidGst = { ...completeProfile, gstNumber: 'INVALID_GST' };
    const res2 = checkBuyerProfileCompletion(invalidGst);
    expect(res2.issues.find((i) => i.field === 'gstNumber')?.status).toBe('invalid');
  });

  it('derives PAN from valid GSTIN when panNumber is empty', () => {
    const profileWithoutPan = { ...completeProfile, panNumber: '', gstNumber: '27BLMPK1234F1Z5' };
    const res = checkBuyerProfileCompletion(profileWithoutPan);
    // Should derive BLMPK1234F from 27BLMPK1234F1Z5
    expect(res.issues.find((i) => i.field === 'panNumber')).toBeUndefined();
    expect(res.completedFields).toContain('panNumber');
  });

  it('flags invalid PAN when pan format is invalid and cannot be derived', () => {
    const invalidPan = { ...completeProfile, panNumber: '12345', gstNumber: '' };
    const res = checkBuyerProfileCompletion(invalidPan);
    expect(res.issues.find((i) => i.field === 'panNumber')?.status).toBe('invalid');
  });

  it('detects missing street address or street too short', () => {
    const missingStreet = { ...completeProfile, street: '' };
    const res1 = checkBuyerProfileCompletion(missingStreet);
    expect(res1.issues.find((i) => i.field === 'street')?.status).toBe('missing');

    const shortStreet = { ...completeProfile, street: 'AB' };
    const res2 = checkBuyerProfileCompletion(shortStreet);
    expect(res2.issues.find((i) => i.field === 'street')?.status).toBe('invalid');
  });

  it('detects missing city and state', () => {
    const missingCityState = { ...completeProfile, city: '', state: '' };
    const res = checkBuyerProfileCompletion(missingCityState);
    expect(res.issues.find((i) => i.field === 'city')?.status).toBe('missing');
    expect(res.issues.find((i) => i.field === 'state')?.status).toBe('missing');
  });

  it('detects missing, invalid, or dummy pincodes', () => {
    const missingPin = { ...completeProfile, pincode: '' };
    expect(checkBuyerProfileCompletion(missingPin).issues.find((i) => i.field === 'pincode')?.status).toBe('missing');

    const non6Digit = { ...completeProfile, pincode: '40009' };
    expect(checkBuyerProfileCompletion(non6Digit).issues.find((i) => i.field === 'pincode')?.status).toBe('invalid');

    const dummyPin1 = { ...completeProfile, pincode: '000000' };
    expect(checkBuyerProfileCompletion(dummyPin1).issues.find((i) => i.field === 'pincode')?.status).toBe('invalid');

    const dummyPin2 = { ...completeProfile, pincode: '123456' };
    expect(checkBuyerProfileCompletion(dummyPin2).issues.find((i) => i.field === 'pincode')?.status).toBe('invalid');

    const dummyPin3 = { ...completeProfile, pincode: '111111' };
    expect(checkBuyerProfileCompletion(dummyPin3).issues.find((i) => i.field === 'pincode')?.status).toBe('invalid');
  });

  it('detects missing or invalid contact person details', () => {
    const missingContactName = { ...completeProfile, contactName: '' };
    expect(checkBuyerProfileCompletion(missingContactName).issues.find((i) => i.field === 'contactName')?.status).toBe('missing');

    const missingEmail = { ...completeProfile, contactEmail: '' };
    expect(checkBuyerProfileCompletion(missingEmail).issues.find((i) => i.field === 'contactEmail')?.status).toBe('missing');

    const invalidEmail = { ...completeProfile, contactEmail: 'not-an-email' };
    expect(checkBuyerProfileCompletion(invalidEmail).issues.find((i) => i.field === 'contactEmail')?.status).toBe('invalid');
  });

  it('detects missing, placeholder, or invalid mobile numbers', () => {
    const missingPhone = { ...completeProfile, contactPhone: '' };
    expect(checkBuyerProfileCompletion(missingPhone).issues.find((i) => i.field === 'contactPhone')?.status).toBe('missing');

    const placeholderPhone1 = { ...completeProfile, contactPhone: '+91 9999999999' };
    expect(checkBuyerProfileCompletion(placeholderPhone1).issues.find((i) => i.field === 'contactPhone')?.status).toBe('invalid');

    const placeholderPhone2 = { ...completeProfile, contactPhone: '0000000000' };
    expect(checkBuyerProfileCompletion(placeholderPhone2).issues.find((i) => i.field === 'contactPhone')?.status).toBe('invalid');

    const shortPhone = { ...completeProfile, contactPhone: '98765' };
    expect(checkBuyerProfileCompletion(shortPhone).issues.find((i) => i.field === 'contactPhone')?.status).toBe('invalid');
  });

  it('detects missing or empty product categories', () => {
    const emptyCategories = { ...completeProfile, categories: [] };
    const res1 = checkBuyerProfileCompletion(emptyCategories);
    expect(res1.isComplete).toBe(false);
    const catIssue = res1.issues.find((i) => i.field === 'categories');
    expect(catIssue?.status).toBe('missing');
    expect(res1.missingSections).toContain('categories');

    const invalidCategories = {
      ...completeProfile,
      categories: [{ major: '', minor: '' }] as any,
    };
    const res2 = checkBuyerProfileCompletion(invalidCategories);
    expect(res2.isComplete).toBe(false);
    expect(res2.issues.find((i) => i.field === 'categories')?.status).toBe('missing');
  });

  it('correctly maps missing sections for navigation anchors', () => {
    const partialProfile = {
      ...completeProfile,
      street: '',
      pincode: '000000',
      categories: [],
    };
    const res = checkBuyerProfileCompletion(partialProfile);
    expect(res.missingSections).toContain('address');
    expect(res.missingSections).toContain('categories');
    expect(res.missingSections).not.toContain('organization');
    expect(res.missingSections).not.toContain('contact');

    expect(PROFILE_SECTIONS.organization.anchor).toBe('section-organization');
    expect(PROFILE_SECTIONS.address.anchor).toBe('section-address');
    expect(PROFILE_SECTIONS.contact.anchor).toBe('section-contact');
    expect(PROFILE_SECTIONS.categories.anchor).toBe('section-categories');
  });
});
