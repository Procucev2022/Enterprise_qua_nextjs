/**
 * Centralized Input Validation Schemas for Enterprise Backend
 * Single source of truth for all API payload, query parameter, and entity boundaries.
 */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/i;
const PHONE_REGEX = /^[+]?[(]?[0-9]{1,4}[)]?[-\s./0-9]{7,15}$/;

// Delivery pincode or zipcode. Broader than an Indian six-digit PIN because the
// same field carries international zipcodes for export orders, which are
// alphanumeric and may contain a space or hyphen. Mirrors PINCODE_PATTERN in
// frontend/lib/validationSchemas.ts.
const PINCODE_REGEX = /^[A-Za-z0-9][A-Za-z0-9\s-]{2,9}$/;

// Indian mobile number accepted at sign-in and registration. Mirrors
// INDIAN_MOBILE_PATTERN in frontend/lib/validationSchemas.ts. The identity
// schema stores these normalised to +91XXXXXXXXXX, so the submitted value must
// resolve to exactly ten national digits beginning 6-9.
const INDIAN_MOBILE_REGEX = /^(?:\+?91[-\s]?|0)?[6-9]\d{9}$/;
const INDIAN_MOBILE_MESSAGE = 'Enter a valid 10-digit Indian mobile number, for example 9876543210.';

// Email OTPs are 6 numeric digits, matching the `otp_store.otp` column the Java
// p2pservices app writes. Kept here rather than derived from IDENTITY_OTP_CONFIG
// because config/constants.js requires this module, not the other way round.
const OTP_CODE_REGEX = /^\d{6}$/;
const OTP_CODE_MESSAGE = 'Enter the 6-digit verification code sent to your registered email address.';

const VALIDATION_SCHEMAS = {
  createRFQ: {
    title: { type: 'string', required: true, minLength: 3, maxLength: 200 },
    category: { type: 'string', required: true, minLength: 2 },
    // Optional. A document that prices nothing yields no budget, and requiring
    // one forced the buyer to invent a ceiling vendors would then quote against.
    budget: { type: 'number', required: false, min: 0 },
    deliveryLocation: { type: 'string', required: false, maxLength: 200 },
    deliveryPincode: {
      type: 'string',
      required: false,
      pattern: PINCODE_REGEX,
      message: 'Pincode must be 3 to 10 letters, digits, spaces or hyphens.',
    },
    // Metadata for documents already stored by POST /api/rfqs/attachments.
    attachments: { type: 'array', required: false },
    targetDeliveryDate: { type: 'string', required: true },
    lineItems: { type: 'array', required: false },
  },

  // Document handed to POST /api/rfqs/extract for Gemini line-item extraction.
  // Either documentText (client-flattened spreadsheet) or inlineData (PDF/image
  // base64) must be present; that either/or rule is enforced in the service,
  // which can report a precise reason the wizard shows to the buyer.
  extractRFQ: {
    fileName: { type: 'string', required: true, minLength: 1, maxLength: 260 },
    documentText: { type: 'string', required: false },
    inlineData: { type: 'string', required: false },
    mimeType: { type: 'string', required: false, maxLength: 120 },
  },

  // Raw extracted rows handed to POST /api/rfqs/ingest. The rows themselves are
  // A supporting document attached to an RFQ. The MIME allow-list and the size
  // ceiling are enforced by rfqAttachmentService, which owns those limits.
  uploadRFQAttachment: {
    fileName: { type: 'string', required: true, minLength: 1, maxLength: 260 },
    mimeType: { type: 'string', required: true, minLength: 3, maxLength: 150 },
    content: { type: 'string', required: true, minLength: 1, message: 'content must be base64 file data.' },
  },

  // deliberately loose because they come from arbitrary spreadsheets; each row is
  // normalised and validated per-field by rfqIngestionService instead.
  ingestRFQ: {
    lineItems: { type: 'array', required: true, message: 'lineItems must be an array of extracted rows.' },
    title: { type: 'string', required: false, maxLength: 200 },
    category: { type: 'string', required: false },
    // Overall value stated on the document. Optional because most BOQs price only
    // the individual lines, which the ingestion service sums instead.
    estimatedBudget: { type: 'number', required: false, min: 0 },
    source: {
      type: 'string',
      required: false,
      enum: ['email_gateway', 'web_portal', 'email_upload', 'manual_entry'],
    },
    sourceFileName: { type: 'string', required: false, maxLength: 260 },
    sourceEmail: { type: 'string', required: false, pattern: EMAIL_REGEX, message: 'Valid source email required' },
  },

  vendorRegistration: {
    name: { type: 'string', required: true, minLength: 2, maxLength: 150 },
    corporateEmail: { type: 'string', required: true, pattern: EMAIL_REGEX, message: 'Valid corporate email address required' },
    gstin: { type: 'string', required: false, pattern: GSTIN_REGEX, message: 'Valid 15-character GSTIN format required' },
    majorCategory: { type: 'string', required: true },
    contactPhone: { type: 'string', required: false, pattern: PHONE_REGEX, message: 'Valid phone number required' },
  },

  submitQuote: {
    rfqId: { type: 'string', required: true },
    vendorId: { type: 'string', required: true },
    unitPrice: { type: 'number', required: true, min: 0.01 },
    totalPrice: { type: 'number', required: true, min: 0.01 },
    leadTimeDays: { type: 'number', required: true, min: 1 },
    warrantyYears: { type: 'number', required: false, min: 0 },
    complianceStatus: { type: 'string', required: false },
  },

  updateRatingRevision: {
    vendorId: { type: 'string', required: true },
    revisedScore: { type: 'number', required: true, min: 0, max: 100 },
    revisionReason: { type: 'string', required: true, minLength: 5, maxLength: 500 },
  },

  auditQuery: {
    page: { type: 'number', required: false, min: 1 },
    limit: { type: 'number', required: false, min: 1, max: 100 },
    severity: { type: 'string', required: false, enum: ['INFO', 'WARN', 'ERROR', 'CRITICAL'] },
    category: { type: 'string', required: false },
  },

  buyerAccount: {
    name: { type: 'string', required: true, minLength: 2 },
    email: { type: 'string', required: true, pattern: EMAIL_REGEX, message: 'Valid corporate email required' },
    role: { type: 'string', required: true },
    department: { type: 'string', required: false },
  },

  encryptPayload: {
    plaintext: { type: 'string', required: true, minLength: 1 },
    secretKey: { type: 'string', required: false, minLength: 8 },
    encoding: { type: 'string', required: false, enum: ['hex', 'base64'] },
  },

  decryptPayload: {
    ciphertext: { type: 'string', required: true, minLength: 1 },
    iv: { type: 'string', required: true, minLength: 12 },
    authTag: { type: 'string', required: true, minLength: 16 },
    salt: { type: 'string', required: false },
    secretKey: { type: 'string', required: false, minLength: 8 },
    encoding: { type: 'string', required: false, enum: ['hex', 'base64'] },
  },

  verifyCryptoIntegrity: {
    ciphertext: { type: 'string', required: true, minLength: 1 },
    iv: { type: 'string', required: true, minLength: 12 },
    authTag: { type: 'string', required: true, minLength: 16 },
  },

  // `mobile` is optional at the schema level because the same endpoint also
  // serves the OTP (`code`) path, which identifies the account by email alone.
  // Password sign-in requires it, and that is enforced in authService.
  login: {
    email: { type: 'string', required: true, message: 'Email is required.' },
    mobile: { type: 'string', required: false, pattern: INDIAN_MOBILE_REGEX, message: INDIAN_MOBILE_MESSAGE },
    password: { type: 'string', required: false },
    code: { type: 'string', required: false, pattern: OTP_CODE_REGEX, message: OTP_CODE_MESSAGE },
  },

  // The Java `/authenticate` OTP branch validates the email + phone pair before
  // issuing a code, so the mobile number is mandatory on both OTP endpoints.
  requestOtp: {
    email: { type: 'string', required: true, message: 'Email is required to request OTP.' },
    mobile: {
      type: 'string',
      required: true,
      pattern: INDIAN_MOBILE_REGEX,
      message: INDIAN_MOBILE_MESSAGE,
    },
    roleHint: { type: 'string', required: false },
  },

  verifyOtp: {
    email: { type: 'string', required: true, message: 'Email and verification code are required.' },
    code: {
      type: 'string',
      required: true,
      pattern: OTP_CODE_REGEX,
      message: OTP_CODE_MESSAGE,
    },
    mobile: {
      type: 'string',
      required: true,
      pattern: INDIAN_MOBILE_REGEX,
      message: INDIAN_MOBILE_MESSAGE,
    },
  },

  register: {
    email: { type: 'string', required: true, message: 'Email is required for registration.' },
    name: { type: 'string', required: false },
    password: { type: 'string', required: false },
    mobile: { type: 'string', required: false, pattern: INDIAN_MOBILE_REGEX, message: INDIAN_MOBILE_MESSAGE },
    role: { type: 'string', required: false },
    orgName: { type: 'string', required: false },
  },
};


/**
 * Universal Schema Validator
 * Validates a payload against a defined schema and returns structured field errors.
 */
function validatePayload(schema, data = {}) {
  const errors = {};
  const sanitized = {};

  if (!schema || typeof schema !== 'object') {
    return { isValid: true, errors: {}, sanitizedData: data };
  }

  for (const [field, rules] of Object.entries(schema)) {
    const value = data[field];

    // Required check
    if (rules.required && (value === undefined || value === null || value === '')) {
      errors[field] = rules.message || `${field} is required.`;
      continue;
    }

    if (value !== undefined && value !== null && value !== '') {
      // Type checks
      if (rules.type === 'number') {
        const num = Number(value);
        if (isNaN(num)) {
          errors[field] = `${field} must be a valid number.`;
          continue;
        }
        if (rules.min !== undefined && num < rules.min) {
          errors[field] = `${field} must be at least ${rules.min}.`;
          continue;
        }
        if (rules.max !== undefined && num > rules.max) {
          errors[field] = `${field} must not exceed ${rules.max}.`;
          continue;
        }
        sanitized[field] = num;
      } else if (rules.type === 'string') {
        const str = String(value).trim();
        if (rules.minLength && str.length < rules.minLength) {
          errors[field] = `${field} must be at least ${rules.minLength} characters.`;
          continue;
        }
        if (rules.maxLength && str.length > rules.maxLength) {
          errors[field] = `${field} must not exceed ${rules.maxLength} characters.`;
          continue;
        }
        if (rules.pattern && !rules.pattern.test(str)) {
          errors[field] = rules.message || `${field} is in an invalid format.`;
          continue;
        }
        if (rules.enum && !rules.enum.includes(str)) {
          errors[field] = `${field} must be one of: ${rules.enum.join(', ')}.`;
          continue;
        }
        sanitized[field] = str;
      } else if (rules.type === 'array') {
        if (!Array.isArray(value)) {
          errors[field] = `${field} must be an array.`;
          continue;
        }
        sanitized[field] = value;
      } else {
        sanitized[field] = value;
      }
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
    sanitizedData: { ...data, ...sanitized },
  };
}

module.exports = {
  EMAIL_REGEX,
  PINCODE_REGEX,
  GSTIN_REGEX,
  PHONE_REGEX,
  INDIAN_MOBILE_REGEX,
  INDIAN_MOBILE_MESSAGE,
  OTP_CODE_REGEX,
  OTP_CODE_MESSAGE,
  VALIDATION_SCHEMAS,
  validatePayload,
};
