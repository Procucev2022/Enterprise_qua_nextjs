/**
 * Centralized Input Validation Schemas for Enterprise Backend
 * Single source of truth for all API payload, query parameter, and entity boundaries.
 */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/i;
const PHONE_REGEX = /^[+]?[(]?[0-9]{1,4}[)]?[-\s./0-9]{7,15}$/;

const VALIDATION_SCHEMAS = {
  createRFQ: {
    title: { type: 'string', required: true, minLength: 3, maxLength: 200 },
    category: { type: 'string', required: true, minLength: 2 },
    budget: { type: 'number', required: true, min: 1 },
    targetDeliveryDate: { type: 'string', required: true },
    lineItems: { type: 'array', required: false },
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
  GSTIN_REGEX,
  PHONE_REGEX,
  VALIDATION_SCHEMAS,
  validatePayload,
};
