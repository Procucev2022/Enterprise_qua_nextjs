/**
 * Enterprise Frontend Input Validation Schemas
 * Single source of truth for all form validations, user input limits, and payload verification.
 */

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/i;
export const PHONE_PATTERN = /^[+]?[(]?[0-9]{1,4}[)]?[-\s./0-9]{7,15}$/;

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
  rfqIngestion: {
    title: { required: true, minLength: 3, maxLength: 200, message: 'Title must be between 3 and 200 characters' },
    category: { required: true, message: 'Category selection is required' },
    budget: { required: true, type: 'number', min: 1, message: 'Estimated budget must be greater than zero' },
    targetDeliveryDate: { required: true, message: 'Target delivery date is required' },
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
