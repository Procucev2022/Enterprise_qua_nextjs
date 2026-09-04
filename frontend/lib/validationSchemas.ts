/**
 * Enterprise Frontend Input Validation Schemas
 * Single source of truth for all form validations, user input limits, and payload verification.
 */

import { UI_STRINGS } from './uiStrings';

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/i;
export const PHONE_PATTERN = /^[+]?[(]?[0-9]{1,4}[)]?[-\s./0-9]{7,15}$/;

/**
 * Indian mobile number accepted at sign-in and registration. The identity
 * database stores these normalised to +91XXXXXXXXXX, so the input must resolve
 * to exactly ten national digits beginning 6-9, optionally prefixed with
 * +91 / 0 / 91.
 */
export const INDIAN_MOBILE_PATTERN = /^(?:\+?91[-\s]?|0)?[6-9]\d{9}$/;

/**
 * Delivery pincode or zipcode.
 *
 * Deliberately broader than an Indian six-digit PIN: the same field carries
 * international zipcodes for export orders, which are alphanumeric and may
 * contain a space or hyphen (for example SW1A 1AA or 12345-6789). It must still
 * start with a letter or digit so a stray separator is rejected.
 */
export const PINCODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9\s-]{2,9}$/;

/**
 * Statutory identifiers on the buyer organisation profile. Each mirrors the
 * corresponding regex in backend/src/config/validationSchemas.js, which is the
 * gate that actually protects the `organization` row; these exist so the buyer is
 * told about a malformed value while typing rather than after a round trip.
 */
export const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/i;
export const CIN_PATTERN = /^[LUu][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/i;
export const WEBSITE_PATTERN = /^https?:\/\/[^\s/$.?#][^\s]*$/i;

/**
 * Registered-office PIN code. Narrower than PINCODE_PATTERN above, which carries
 * international delivery zipcodes: a buyer's registered address is an Indian
 * statutory address, so it is exactly six digits and cannot begin with zero.
 */
export const INDIAN_PINCODE_PATTERN = /^[1-9][0-9]{5}$/;

export interface FieldRule {
  required?: boolean;
  type?: 'string' | 'number' | 'array';
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: RegExp;
  enum?: string[];
  message?: string;
}

export type FormSchema = Record<string, FieldRule>;

export const FORM_SCHEMAS: Record<string, FormSchema> = {
  /**
   * Password sign-in. The backend re-checks the same three fields and resolves
   * the account by email + mobile together, so the mobile number is a hard
   * requirement here rather than an optional contact detail.
   */
  loginForm: {
    email: { required: true, pattern: EMAIL_PATTERN, message: UI_STRINGS.auth.emailInvalid },
    mobile: { required: true, pattern: INDIAN_MOBILE_PATTERN, message: UI_STRINGS.auth.mobileInvalid },
    password: { required: true, message: UI_STRINGS.auth.passwordRequired },
  },

  rfqIngestion: {
    title: { required: true, minLength: 3, maxLength: 200, message: 'Title must be between 3 and 200 characters' },
    category: { required: true, message: 'Category selection is required' },
    // Optional: a document that prices nothing yields no figure, and a required
    // budget forced the buyer to invent a ceiling that vendors would then quote
    // against. Zero is accepted and rendered as "not set" rather than as ₹0.
    budget: { required: false, type: 'number', min: 0, message: 'Estimated budget cannot be negative' },
    targetDeliveryDate: { required: true, message: 'Target delivery date is required' },
    // Both delivery fields are mandatory. Vendors rate freight on the destination
    // and its pincode, so quotes raised without them are not comparable against
    // quotes that have them, and the buyer cannot resolve the difference later.
    deliveryLocation: {
      required: true,
      minLength: 3,
      maxLength: 200,
      message: UI_STRINGS.rfqExtraction.deliveryLocationSchemaMessage,
    },
    deliveryPincode: {
      required: true,
      pattern: PINCODE_PATTERN,
      message: UI_STRINGS.rfqExtraction.deliveryPincodeInvalidMessage,
    },
  },

  vendorQualification: {
    companyName: { required: true, minLength: 2, maxLength: 150, message: 'Company legal name is required' },
    corporateEmail: { required: true, pattern: EMAIL_PATTERN, message: 'Please provide a valid corporate email' },
    contactPhone: { required: false, pattern: PHONE_PATTERN, message: 'Please provide a valid phone number' },
    gstin: { required: false, pattern: GSTIN_PATTERN, message: 'GSTIN format must be valid (15 alphanumeric characters)' },
    category: { required: true, message: 'Primary industry category is required' },
  },

  quotationForm: {
    unitPrice: { required: true, type: 'number', min: 0.01, message: 'Unit price must be greater than zero' },
    totalPrice: { required: true, type: 'number', min: 0.01, message: 'Total price must be greater than zero' },
    leadTimeDays: { required: true, type: 'number', min: 1, message: 'Lead time must be at least 1 day' },
    paymentTerms: { required: true, minLength: 2, message: 'Payment terms are required' },
  },

  /**
   * Buyer organisation profile form.
   *
   * Only the legal entity name is required, matching the server: the endpoint
   * patches whatever is supplied and leaves the rest of the stored record alone,
   * so a buyer can fill the profile in over several visits. The optional fields
   * are still format-checked whenever they carry a value, which the old Angular
   * screen did for GSTIN alone.
   */
  buyerProfile: {
    companyName: { required: true, minLength: 2, maxLength: 255, message: UI_STRINGS.buyerProfile.companyNameRequired },
    panNumber: { required: false, pattern: PAN_PATTERN, message: UI_STRINGS.buyerProfile.panInvalid },
    gstNumber: { required: false, pattern: GSTIN_PATTERN, message: UI_STRINGS.buyerProfile.gstInvalid },
    cinNumber: { required: false, pattern: CIN_PATTERN, message: UI_STRINGS.buyerProfile.cinInvalid },
    website: { required: false, pattern: WEBSITE_PATTERN, message: UI_STRINGS.buyerProfile.websiteInvalid },
    pincode: { required: false, pattern: INDIAN_PINCODE_PATTERN, message: UI_STRINGS.buyerProfile.pincodeInvalid },
  },

  buyerAccount: {
    name: { required: true, minLength: 2, message: 'Full name is required' },
    email: { required: true, pattern: EMAIL_PATTERN, message: 'Valid corporate email required' },
    department: { required: true, message: 'Department is required' },
    approvalLimit: { required: false, type: 'number', min: 0, message: 'Approval limit cannot be negative' },
  },

  vendorRatingRevision: {
    revisedScore: { required: true, type: 'number', min: 0, max: 100, message: 'Score must be between 0 and 100' },
    revisionReason: { required: true, minLength: 5, maxLength: 500, message: 'Revision reason must be between 5 and 500 characters' },
  },

  cryptoEncryption: {
    plaintext: { required: true, minLength: 1, message: 'Plaintext data is required for encryption' },
    secretKey: { required: false, minLength: 8, message: 'Encryption key must be at least 8 characters' },
  },

  cryptoDecryption: {
    ciphertext: { required: true, minLength: 1, message: 'Ciphertext is required for decryption' },
    iv: { required: true, minLength: 12, message: 'Initialization vector is required' },
    authTag: { required: true, minLength: 16, message: 'Authentication tag is required' },
  },
};


/**
 * Universal Form Data Validator
 * Validates form state against centralized schemas and returns field-level error messages.
 */
export function validateFormData(schema: FormSchema, data: Record<string, any>): {
  isValid: boolean;
  fieldErrors: Record<string, string>;
} {
  const fieldErrors: Record<string, string> = {};

  if (!schema) {
    return { isValid: true, fieldErrors: {} };
  }

  for (const [field, rule] of Object.entries(schema)) {
    const value = data[field];

    // Required check
    if (rule.required && (value === undefined || value === null || value === '')) {
      fieldErrors[field] = rule.message || `${field} is required`;
      continue;
    }

    if (value !== undefined && value !== null && value !== '') {
      // Numeric check
      if (rule.type === 'number') {
        const num = Number(value);
        if (isNaN(num)) {
          fieldErrors[field] = rule.message || `${field} must be a number`;
          continue;
        }
        if (rule.min !== undefined && num < rule.min) {
          fieldErrors[field] = rule.message || `${field} must be at least ${rule.min}`;
          continue;
        }
        if (rule.max !== undefined && num > rule.max) {
          fieldErrors[field] = rule.message || `${field} cannot exceed ${rule.max}`;
          continue;
        }
      } else if (rule.type === 'string' || typeof value === 'string') {
        const str = String(value).trim();
        if (rule.minLength && str.length < rule.minLength) {
          fieldErrors[field] = rule.message || `${field} must be at least ${rule.minLength} characters`;
          continue;
        }
        if (rule.maxLength && str.length > rule.maxLength) {
          fieldErrors[field] = rule.message || `${field} cannot exceed ${rule.maxLength} characters`;
          continue;
        }
        if (rule.pattern && !rule.pattern.test(str)) {
          fieldErrors[field] = rule.message || `${field} format is invalid`;
          continue;
        }
      }
    }
  }

  return {
    isValid: Object.keys(fieldErrors).length === 0,
    fieldErrors,
  };
}
