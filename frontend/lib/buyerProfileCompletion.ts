import {
  EMAIL_PATTERN,
  GSTIN_PATTERN,
  PAN_PATTERN,
  INDIAN_MOBILE_PATTERN,
  isDummyPincode,
  derivePanFromGstin,
} from '@/lib/validationSchemas';
import type { BuyerAccount, BuyerProfile, BuyerProfileCategory } from '@/lib/types';

export type ProfileSectionKey = 'organization' | 'address' | 'contact' | 'categories';

export interface ProfileFieldIssue {
  field: string;
  label: string;
  section: ProfileSectionKey;
  sectionTitle: string;
  sectionAnchor: string;
  issue: string;
  status: 'missing' | 'invalid';
}

export interface ProfileCompletionResult {
  isComplete: boolean;
  completionPercentage: number;
  completedCount: number;
  totalCount: number;
  issues: ProfileFieldIssue[];
  missingSections: ProfileSectionKey[];
  completedFields: string[];
}

export const PROFILE_SECTIONS: Record<
  ProfileSectionKey,
  { title: string; anchor: string; description: string }
> = {
  organization: {
    title: 'Organization & Tax Registration',
    anchor: 'section-organization',
    description: 'Legal Entity Name, Constitution, GSTIN & PAN',
  },
  address: {
    title: 'Registered Corporate Address',
    anchor: 'section-address',
    description: 'Street, City, State & PIN Code',
  },
  contact: {
    title: 'Key Procurement Contact Person',
    anchor: 'section-contact',
    description: 'Contact Name, Official Email & Mobile Number',
  },
  categories: {
    title: 'Relevant Procurement Categories',
    anchor: 'section-categories',
    description: 'Procurement Divisions & Minor Product Categories',
  },
};

/**
 * Checks whether all mandatory buyer profile fields and procurement categories
 * are completed and correctly formatted.
 *
 * Evaluates both BuyerProfile (from GET /api/buyer-profile/me) and
 * BuyerAccount (from GET /api/buyer-accounts/active or store).
 */
export function checkBuyerProfileCompletion(
  profile: Partial<BuyerProfile> | Partial<BuyerAccount> | null | undefined
): ProfileCompletionResult {
  const issues: ProfileFieldIssue[] = [];
  const completedFields: string[] = [];

  if (!profile) {
    return {
      isComplete: false,
      completionPercentage: 0,
      completedCount: 0,
      totalCount: 12,
      issues: [
        {
          field: 'companyName',
          label: 'Legal Entity Name',
          section: 'organization',
          sectionTitle: PROFILE_SECTIONS.organization.title,
          sectionAnchor: PROFILE_SECTIONS.organization.anchor,
          issue: 'Legal entity name is required.',
          status: 'missing',
        },
        {
          field: 'organizationType',
          label: 'Organization Constitution',
          section: 'organization',
          sectionTitle: PROFILE_SECTIONS.organization.title,
          sectionAnchor: PROFILE_SECTIONS.organization.anchor,
          issue: 'Organization constitution / legal structure is required.',
          status: 'missing',
        },
        {
          field: 'gstNumber',
          label: 'GSTIN / GST Number',
          section: 'organization',
          sectionTitle: PROFILE_SECTIONS.organization.title,
          sectionAnchor: PROFILE_SECTIONS.organization.anchor,
          issue: 'GSTIN is required for tax and statutory compliance.',
          status: 'missing',
        },
        {
          field: 'panNumber',
          label: 'PAN Number',
          section: 'organization',
          sectionTitle: PROFILE_SECTIONS.organization.title,
          sectionAnchor: PROFILE_SECTIONS.organization.anchor,
          issue: 'Permanent Account Number (PAN) is required.',
          status: 'missing',
        },
        {
          field: 'street',
          label: 'Registered Street Address',
          section: 'address',
          sectionTitle: PROFILE_SECTIONS.address.title,
          sectionAnchor: PROFILE_SECTIONS.address.anchor,
          issue: 'Street address is required for plant & delivery logistics.',
          status: 'missing',
        },
        {
          field: 'city',
          label: 'City',
          section: 'address',
          sectionTitle: PROFILE_SECTIONS.address.title,
          sectionAnchor: PROFILE_SECTIONS.address.anchor,
          issue: 'City is required.',
          status: 'missing',
        },
        {
          field: 'state',
          label: 'State',
          section: 'address',
          sectionTitle: PROFILE_SECTIONS.address.title,
          sectionAnchor: PROFILE_SECTIONS.address.anchor,
          issue: 'State is required.',
          status: 'missing',
        },
        {
          field: 'pincode',
          label: 'PIN Code',
          section: 'address',
          sectionTitle: PROFILE_SECTIONS.address.title,
          sectionAnchor: PROFILE_SECTIONS.address.anchor,
          issue: 'PIN code is required.',
          status: 'missing',
        },
        {
          field: 'contactName',
          label: 'Primary Contact Person',
          section: 'contact',
          sectionTitle: PROFILE_SECTIONS.contact.title,
          sectionAnchor: PROFILE_SECTIONS.contact.anchor,
          issue: 'Contact person name is required.',
          status: 'missing',
        },
        {
          field: 'contactEmail',
          label: 'Corporate Email Address',
          section: 'contact',
          sectionTitle: PROFILE_SECTIONS.contact.title,
          sectionAnchor: PROFILE_SECTIONS.contact.anchor,
          issue: 'Official contact email address is required.',
          status: 'missing',
        },
        {
          field: 'contactPhone',
          label: 'Contact Mobile Number',
          section: 'contact',
          sectionTitle: PROFILE_SECTIONS.contact.title,
          sectionAnchor: PROFILE_SECTIONS.contact.anchor,
          issue: 'Mobile number is required.',
          status: 'missing',
        },
        {
          field: 'categories',
          label: 'Product Categories',
          section: 'categories',
          sectionTitle: PROFILE_SECTIONS.categories.title,
          sectionAnchor: PROFILE_SECTIONS.categories.anchor,
          issue: 'At least one procurement category must be selected to receive relevant supplier quotations.',
          status: 'missing',
        },
      ],
      missingSections: ['organization', 'address', 'contact', 'categories'],
      completedFields: [],
    };
  }

  // 1. Legal Entity / Company Name
  const rawCompanyName = (profile as any).companyName || (profile as any).organizationName || '';
  const trimmedCompanyName = String(rawCompanyName).trim();
  if (!trimmedCompanyName) {
    issues.push({
      field: 'companyName',
      label: 'Legal Entity Name',
      section: 'organization',
      sectionTitle: PROFILE_SECTIONS.organization.title,
      sectionAnchor: PROFILE_SECTIONS.organization.anchor,
      issue: 'Legal entity name is required.',
      status: 'missing',
    });
  } else if (trimmedCompanyName.length < 2) {
    issues.push({
      field: 'companyName',
      label: 'Legal Entity Name',
      section: 'organization',
      sectionTitle: PROFILE_SECTIONS.organization.title,
      sectionAnchor: PROFILE_SECTIONS.organization.anchor,
      issue: 'Legal entity name must be at least 2 characters long.',
      status: 'invalid',
    });
  } else {
    completedFields.push('companyName');
  }

  // 2. Organization Constitution / Type
  const rawOrgType = (profile as any).organizationType;
  const trimmedOrgType = typeof rawOrgType === 'string' ? rawOrgType.trim() : '';
  if (!trimmedOrgType) {
    issues.push({
      field: 'organizationType',
      label: 'Organization Constitution',
      section: 'organization',
      sectionTitle: PROFILE_SECTIONS.organization.title,
      sectionAnchor: PROFILE_SECTIONS.organization.anchor,
      issue: 'Organization constitution / legal structure is required.',
      status: 'missing',
    });
  } else {
    completedFields.push('organizationType');
  }

  // 3. GSTIN / GST Number
  const rawGst = (profile as any).gstNumber || (profile as any).gstin || (profile as any).gst || '';
  const trimmedGst = String(rawGst).trim().toUpperCase();
  if (!trimmedGst) {
    issues.push({
      field: 'gstNumber',
      label: 'GSTIN / GST Number',
      section: 'organization',
      sectionTitle: PROFILE_SECTIONS.organization.title,
      sectionAnchor: PROFILE_SECTIONS.organization.anchor,
      issue: 'GSTIN is required for tax and statutory compliance.',
      status: 'missing',
    });
  } else if (!GSTIN_PATTERN.test(trimmedGst)) {
    issues.push({
      field: 'gstNumber',
      label: 'GSTIN / GST Number',
      section: 'organization',
      sectionTitle: PROFILE_SECTIONS.organization.title,
      sectionAnchor: PROFILE_SECTIONS.organization.anchor,
      issue: 'Invalid GSTIN format (15 alphanumeric characters required e.g. 27AAACL1234F1Z5).',
      status: 'invalid',
    });
  } else {
    completedFields.push('gstNumber');
  }

  // 4. PAN Number
  const rawPan =
    (profile as any).panNumber ||
    (profile as any).pan ||
    (trimmedGst && GSTIN_PATTERN.test(trimmedGst) ? derivePanFromGstin(trimmedGst) : '') ||
    '';
  const trimmedPan = String(rawPan).trim().toUpperCase();
  if (!trimmedPan) {
    issues.push({
      field: 'panNumber',
      label: 'PAN Number',
      section: 'organization',
      sectionTitle: PROFILE_SECTIONS.organization.title,
      sectionAnchor: PROFILE_SECTIONS.organization.anchor,
      issue: 'Permanent Account Number (PAN) is required.',
      status: 'missing',
    });
  } else if (!PAN_PATTERN.test(trimmedPan)) {
    issues.push({
      field: 'panNumber',
      label: 'PAN Number',
      section: 'organization',
      sectionTitle: PROFILE_SECTIONS.organization.title,
      sectionAnchor: PROFILE_SECTIONS.organization.anchor,
      issue: 'Invalid PAN format (10 alphanumeric characters required e.g. AAACL1234F).',
      status: 'invalid',
    });
  } else {
    completedFields.push('panNumber');
  }

  // 5. Registered Street Address
  const rawStreet =
    (profile as any).street ||
    (profile as any).streetAddress ||
    (profile as any).address1 ||
    (profile as any).address ||
    (profile as any).registeredAddress ||
    '';
  const trimmedStreet = String(rawStreet).trim();
  if (!trimmedStreet) {
    issues.push({
      field: 'street',
      label: 'Registered Street Address',
      section: 'address',
      sectionTitle: PROFILE_SECTIONS.address.title,
      sectionAnchor: PROFILE_SECTIONS.address.anchor,
      issue: 'Street address is required for plant & delivery logistics.',
      status: 'missing',
    });
  } else if (trimmedStreet.length < 3) {
    issues.push({
      field: 'street',
      label: 'Registered Street Address',
      section: 'address',
      sectionTitle: PROFILE_SECTIONS.address.title,
      sectionAnchor: PROFILE_SECTIONS.address.anchor,
      issue: 'Street address must be at least 3 characters long.',
      status: 'invalid',
    });
  } else {
    completedFields.push('street');
  }

  // 6. City
  const rawCity = (profile as any).city || '';
  const trimmedCity = String(rawCity).trim();
  if (!trimmedCity) {
    issues.push({
      field: 'city',
      label: 'City',
      section: 'address',
      sectionTitle: PROFILE_SECTIONS.address.title,
      sectionAnchor: PROFILE_SECTIONS.address.anchor,
      issue: 'City is required.',
      status: 'missing',
    });
  } else if (trimmedCity.length < 2) {
    issues.push({
      field: 'city',
      label: 'City',
      section: 'address',
      sectionTitle: PROFILE_SECTIONS.address.title,
      sectionAnchor: PROFILE_SECTIONS.address.anchor,
      issue: 'City must be at least 2 characters long.',
      status: 'invalid',
    });
  } else {
    completedFields.push('city');
  }

  // 7. State
  const rawState = (profile as any).state || '';
  const trimmedState = String(rawState).trim();
  if (!trimmedState) {
    issues.push({
      field: 'state',
      label: 'State',
      section: 'address',
      sectionTitle: PROFILE_SECTIONS.address.title,
      sectionAnchor: PROFILE_SECTIONS.address.anchor,
      issue: 'State is required.',
      status: 'missing',
    });
  } else if (trimmedState.length < 2) {
    issues.push({
      field: 'state',
      label: 'State',
      section: 'address',
      sectionTitle: PROFILE_SECTIONS.address.title,
      sectionAnchor: PROFILE_SECTIONS.address.anchor,
      issue: 'State must be at least 2 characters long.',
      status: 'invalid',
    });
  } else {
    completedFields.push('state');
  }

  // 8. PIN Code
  const rawPincode =
    (profile as any).pincode || (profile as any).zip_code || (profile as any).zipCode || '';
  const trimmedPincode = String(rawPincode).trim();
  if (!trimmedPincode) {
    issues.push({
      field: 'pincode',
      label: 'PIN Code',
      section: 'address',
      sectionTitle: PROFILE_SECTIONS.address.title,
      sectionAnchor: PROFILE_SECTIONS.address.anchor,
      issue: 'PIN code is required.',
      status: 'missing',
    });
  } else if (!/^\d{6}$/.test(trimmedPincode)) {
    issues.push({
      field: 'pincode',
      label: 'PIN Code',
      section: 'address',
      sectionTitle: PROFILE_SECTIONS.address.title,
      sectionAnchor: PROFILE_SECTIONS.address.anchor,
      issue: 'PIN code must be exactly 6 numeric digits.',
      status: 'invalid',
    });
  } else if (isDummyPincode(trimmedPincode)) {
    issues.push({
      field: 'pincode',
      label: 'PIN Code',
      section: 'address',
      sectionTitle: PROFILE_SECTIONS.address.title,
      sectionAnchor: PROFILE_SECTIONS.address.anchor,
      issue: 'PIN code cannot be a dummy or placeholder value (e.g. 000000, 123456).',
      status: 'invalid',
    });
  } else {
    completedFields.push('pincode');
  }

  // 9. Primary Contact Person Name
  const rawContactName = (profile as any).contactName || (profile as any).contactPerson || '';
  const trimmedContactName = String(rawContactName).trim();
  if (!trimmedContactName) {
    issues.push({
      field: 'contactName',
      label: 'Primary Contact Person',
      section: 'contact',
      sectionTitle: PROFILE_SECTIONS.contact.title,
      sectionAnchor: PROFILE_SECTIONS.contact.anchor,
      issue: 'Primary procurement contact person name is required.',
      status: 'missing',
    });
  } else if (trimmedContactName.length < 2) {
    issues.push({
      field: 'contactName',
      label: 'Primary Contact Person',
      section: 'contact',
      sectionTitle: PROFILE_SECTIONS.contact.title,
      sectionAnchor: PROFILE_SECTIONS.contact.anchor,
      issue: 'Contact person name must be at least 2 characters long.',
      status: 'invalid',
    });
  } else {
    completedFields.push('contactName');
  }

  // 10. Corporate Email Address
  const rawEmail = (profile as any).contactEmail || (profile as any).corporateEmail || '';
  const trimmedEmail = String(rawEmail).trim().toLowerCase();
  if (!trimmedEmail) {
    issues.push({
      field: 'contactEmail',
      label: 'Corporate Email Address',
      section: 'contact',
      sectionTitle: PROFILE_SECTIONS.contact.title,
      sectionAnchor: PROFILE_SECTIONS.contact.anchor,
      issue: 'Official contact email address is required.',
      status: 'missing',
    });
  } else if (!EMAIL_PATTERN.test(trimmedEmail)) {
    issues.push({
      field: 'contactEmail',
      label: 'Corporate Email Address',
      section: 'contact',
      sectionTitle: PROFILE_SECTIONS.contact.title,
      sectionAnchor: PROFILE_SECTIONS.contact.anchor,
      issue: 'Invalid email address format.',
      status: 'invalid',
    });
  } else {
    completedFields.push('contactEmail');
  }

  // 11. Contact Mobile Number
  const rawPhone = (profile as any).contactPhone || (profile as any).mobileNumber || (profile as any).phone || '';
  const trimmedPhone = String(rawPhone).trim();
  const digitsOnly = trimmedPhone.replace(/\D/g, '');
  const isPlaceholderPhone =
    digitsOnly.includes('9999999999') ||
    digitsOnly.includes('0000000000') ||
    digitsOnly.includes('1111111111');

  if (!trimmedPhone) {
    issues.push({
      field: 'contactPhone',
      label: 'Contact Mobile Number',
      section: 'contact',
      sectionTitle: PROFILE_SECTIONS.contact.title,
      sectionAnchor: PROFILE_SECTIONS.contact.anchor,
      issue: 'Contact mobile number is required.',
      status: 'missing',
    });
  } else if (isPlaceholderPhone) {
    issues.push({
      field: 'contactPhone',
      label: 'Contact Mobile Number',
      section: 'contact',
      sectionTitle: PROFILE_SECTIONS.contact.title,
      sectionAnchor: PROFILE_SECTIONS.contact.anchor,
      issue: 'Please update your mobile number from the temporary placeholder.',
      status: 'invalid',
    });
  } else if (!INDIAN_MOBILE_PATTERN.test(trimmedPhone) && digitsOnly.length < 10) {
    issues.push({
      field: 'contactPhone',
      label: 'Contact Mobile Number',
      section: 'contact',
      sectionTitle: PROFILE_SECTIONS.contact.title,
      sectionAnchor: PROFILE_SECTIONS.contact.anchor,
      issue: 'Valid 10-digit mobile number starting with 6-9 is required.',
      status: 'invalid',
    });
  } else {
    completedFields.push('contactPhone');
  }

  // 12. Buyer Product Categories (Procurement Scope)
  const rawCategories = (profile as any).categories;
  const majorList = (profile as any).supportedMajorCategories;
  const minorList = (profile as any).supportedMinorCategories;

  let hasValidCategories = false;
  if (Array.isArray(rawCategories) && rawCategories.length > 0) {
    hasValidCategories = rawCategories.some(
      (c: any) => Boolean(c && (c.major || c.majorCategory) && (c.minor || c.minorCategory))
    );
  } else if (
    Array.isArray(majorList) &&
    majorList.length > 0 &&
    Array.isArray(minorList) &&
    minorList.length > 0
  ) {
    hasValidCategories = true;
  }

  if (!hasValidCategories) {
    issues.push({
      field: 'categories',
      label: 'Product Categories',
      section: 'categories',
      sectionTitle: PROFILE_SECTIONS.categories.title,
      sectionAnchor: PROFILE_SECTIONS.categories.anchor,
      issue: 'At least one procurement category must be selected to receive relevant supplier quotations.',
      status: 'missing',
    });
  } else {
    completedFields.push('categories');
  }

  const totalCount = 12;
  const completedCount = completedFields.length;
  const completionPercentage = Math.round((completedCount / totalCount) * 100);
  const isComplete = issues.length === 0;

  const missingSections = Array.from(new Set(issues.map((i) => i.section)));

  return {
    isComplete,
    completionPercentage,
    completedCount,
    totalCount,
    issues,
    missingSections,
    completedFields,
  };
}
