/**
 * Enterprise Frontend Input Validation Schemas
 * Single source of truth for all form validations, user input limits, and payload verification.
 */

import { UI_STRINGS } from './uiStrings';

/**
 * Shortest password accepted when an account holder changes their own password.
 *
 * Drives both the `minLength` attribute on the field and the schema rule below,
 * and mirrors PASSWORD_MIN_LENGTH in backend/src/config/validationSchemas.js, so
 * the browser hint, the client check and the server boundary all agree.
 *
 * Defined here rather than in ./constants because that module imports from this
 * one; the reverse import would be circular. It is re-exported from ./constants
 * for callers that expect to find constants there.
 */
export const PASSWORD_MIN_LENGTH = 8;

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
 * Exact 10-digit Indian mobile number: exactly 10 numeric digits starting with 6, 7, 8, or 9.
 */
export const EXACT_10_DIGIT_MOBILE_PATTERN = /^[6-9]\d{9}$/;

/**
 * Normalizes input to at most 10 numeric digits, stripping non-numeric characters
 * and trimming common Indian country code prefixes (+91, 91, 0) when entered.
 */
export function sanitize10DigitMobile(value: string): string {
  let val = String(value || '').replace(/\D/g, '');
  if (val.length === 11 && val.startsWith('0')) {
    val = val.slice(1);
  } else if (val.length === 12 && val.startsWith('91')) {
    val = val.slice(2);
  }
  return val.slice(0, 10);
}
export const PROCUCEV_EMAIL_PATTERN = /^[a-zA-Z0-9._%+-]+@procucev\.com$/i;
export const PROCUCEV_EMAIL_MESSAGE = 'Must be a valid Procucev corporate email address ending in @procucev.com';
export const OTP_CODE_PATTERN = /^\d{6}$/;
export const OTP_CODE_MESSAGE = 'OTP code must be exactly 6 numeric digits';

/**
 * Delivery pincode or zipcode.
 *
 * Deliberately broader than an Indian six-digit PIN: the same field carries
 * international zipcodes for export orders, which are alphanumeric and may
 * contain a space or hyphen (for example SW1A 1AA or 12345-6789). It must still
 * start with a letter or digit so a stray separator is rejected.
 */
export const PINCODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9\s-]{2,9}$/;

export const DUMMY_PINCODES = new Set([
  '000000', '111111', '222222', '333333', '444444',
  '555555', '666666', '777777', '888888', '999999',
  '012345', '123456', '234567', '345678', '456789', '567890',
  '654321', '765432', '876543', '987654', '098765',
  '121212', '212121', '123123', '321321', '000001', '100000',
]);

/**
 * Checks if a string is a dummy, test, or sequential PIN code
 */
export function isDummyPincode(pincode: unknown): boolean {
  if (!pincode || typeof pincode !== 'string') return false;
  const clean = pincode.trim().replace(/\s+/g, '');
  if (!clean) return false;
  if (DUMMY_PINCODES.has(clean)) return true;
  if (/^(\d)\1{5,}$/.test(clean)) return true;
  return false;
}

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
  custom?: (val: unknown) => string | null;
}

export type FormSchema = Record<string, FieldRule>;

export const FORM_SCHEMAS: Record<string, FormSchema> = {
  enterpriseInquiry: {
    companyName: {
      required: true,
      type: 'string',
      minLength: 2,
      maxLength: 200,
      message: 'Company name must be 2 to 200 characters.',
    },
    email: {
      required: true,
      type: 'string',
      maxLength: 320,
      pattern: EMAIL_PATTERN,
      message: 'Enter a valid corporate email address.',
    },
    mobile: {
      required: true,
      type: 'string',
      minLength: 8,
      maxLength: 32,
      pattern: PHONE_PATTERN,
      message: 'Enter a valid mobile number including country code.',
    },
  },
  createInternalTask: {
    title: {
      required: true,
      type: 'string',
      minLength: 2,
      maxLength: 512,
      message: 'Task title must be between 2 and 512 characters.',
    },
    taskCategory: {
      type: 'string',
      required: false,
    },
    taskType: {
      type: 'string',
      required: false,
    },
    priority: {
      type: 'string',
      required: false,
      enum: ['Low', 'Medium', 'High', 'Critical'],
    },
    status: {
      type: 'string',
      required: false,
      enum: [
        'New',
        'Assigned',
        'In Progress',
        'Pending Approval',
        'Completed',
        'Rejected',
        'Cancelled',
        'Pending',
        'Blocked',
        'Escalated',
      ],
    },
    dueDate: {
      type: 'string',
      required: false,
    },
  },
  updateInternalTask: {
    title: {
      type: 'string',
      required: false,
      minLength: 2,
      maxLength: 512,
    },
    status: {
      type: 'string',
      required: false,
      enum: [
        'New',
        'Assigned',
        'In Progress',
        'Pending Approval',
        'Completed',
        'Rejected',
        'Cancelled',
        'Pending',
        'Blocked',
        'Escalated',
      ],
    },
    priority: {
      type: 'string',
      required: false,
      enum: ['Low', 'Medium', 'High', 'Critical'],
    },
  },
  approveInternalTask: {
    remarks: {
      type: 'string',
      required: false,
      maxLength: 2000,
    },
  },
  rejectInternalTask: {
    remarks: {
      type: 'string',
      required: false,
      maxLength: 2000,
    },
  },
  addInternalTaskActivity: {
    comment: {
      type: 'string',
      required: true,
      minLength: 1,
      maxLength: 5000,
      message: 'Comment or note cannot be blank.',
    },
  },

  /**
   * Password sign-in. The backend re-checks the same three fields and resolves
   * the account by email + mobile together, so the mobile number is a hard
   * requirement here rather than an optional contact detail.
   */
  vendorDirectoryOtpRequest: {
    email: { required: true, pattern: PROCUCEV_EMAIL_PATTERN, message: PROCUCEV_EMAIL_MESSAGE },
  },
  vendorDirectoryOtpVerify: {
    email: { required: true, pattern: PROCUCEV_EMAIL_PATTERN, message: PROCUCEV_EMAIL_MESSAGE },
    code: { required: true, pattern: OTP_CODE_PATTERN, message: OTP_CODE_MESSAGE },
  },
  loginForm: {
    email: { required: true, pattern: EMAIL_PATTERN, message: UI_STRINGS.auth.emailInvalid },
    mobile: { required: true, pattern: INDIAN_MOBILE_PATTERN, message: UI_STRINGS.auth.mobileInvalid },
    password: { required: true, message: UI_STRINGS.auth.passwordRequired },
  },

  /**
   * Self-service password change. No email field: the account is resolved from
   * the session token server-side, so the form only ever collects the credential
   * proof and the replacement. `minLength` matches PASSWORD_MIN_LENGTH and the
   * backend's `changePassword` schema, so all three agree on the boundary.
   */
  changePasswordForm: {
    newPassword: {
      required: true,
      minLength: PASSWORD_MIN_LENGTH,
      message: UI_STRINGS.accountSecurity.weakPasswordMessage,
    },
    verificationCode: {
      required: false,
      message: UI_STRINGS.accountSecurity.verificationCodeRequired,
    },
    currentPassword: {
      required: false,
      message: UI_STRINGS.accountSecurity.currentPasswordRequired,
    },
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

  ticketCreateForm: {
    subject: { required: true, minLength: 3, message: 'Ticket subject must be at least 3 characters.' },
  },

  ticketEscalateForm: {
    escalatedTo: { required: true, minLength: 2, message: 'Escalation target or manager name is required.' },
    reason: { required: true, minLength: 3, message: 'Reason for escalation is required.' },
  },

  approvalActionForm: {
    action: { required: true, message: 'Action is required.' },
    password: { required: true, minLength: 1, message: 'Approver password is required.' },
  },

  registrationActionForm: {
    action: { required: true, message: 'Action is required.' },
  },

  buyerRegistrationForm: {
    fullName: { required: true, minLength: 1, message: 'Full Name is required.' },
    companyName: { required: true, minLength: 1, message: 'Company Name is required.' },
    gstNumber: { required: true, pattern: GSTIN_PATTERN, message: UI_STRINGS.auth.gstinInvalid },
    pincode: { required: true, pattern: /^[1-9][0-9]{5}$/, message: 'PIN Code must be 6 digits and cannot start with 0.' },
    city: { required: true, minLength: 1, message: 'City is required.' },
    state: { required: true, minLength: 1, message: 'State is required.' },
    email: { required: true, pattern: EMAIL_PATTERN, message: UI_STRINGS.auth.emailInvalid },
    mobile: { required: true, pattern: EXACT_10_DIGIT_MOBILE_PATTERN, message: UI_STRINGS.auth.mobileInvalid },
    password: { required: true, minLength: PASSWORD_MIN_LENGTH, message: UI_STRINGS.auth.passwordTooShort },
  },

  extendRFQ: {
    hours: {
      required: true,
      type: 'number',
      custom: (val: unknown) => ([24, 48].includes(Number(val)) ? null : 'Extension duration must be either 24 or 48 hours.'),
      message: 'Extension hours must be 24 or 48.',
    },
  },

  actionCenterCommunicationSend: {
    message: {
      required: true,
      minLength: 1,
      maxLength: 5000,
      message: UI_STRINGS.actionCenter.communicationModal.validationMessageRequired,
    },
    recipientPhone: {
      required: false,
      pattern: INDIAN_MOBILE_PATTERN,
      message: UI_STRINGS.actionCenter.communicationModal.validationPhoneRequired,
    },
  },
};


/**
 * Universal Form Data Validator
 * Validates form state against centralized schemas and returns field-level error messages.
 */
export function validateFormData(schema: FormSchema, data: Record<string, unknown>): {
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
      // Custom validation check
      if (rule.custom) {
        const customErr = rule.custom(value);
        if (customErr) {
          fieldErrors[field] = customErr;
          continue;
        }
      }

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

export interface PostOfficeDetail {
  Name: string;
  Description?: string | null;
  BranchType?: string;
  DeliveryStatus?: string;
  Circle?: string;
  District: string;
  Division?: string;
  Region?: string;
  State: string;
  Country?: string;
  Pincode?: string;
}

export interface PincodeValidationResult {
  isValid: boolean;
  /**
   * True when the postal records service could not be reached or returned an unusable answer.
   * The PIN is then neither confirmed nor rejected. `isValid` is false, so it is not accepted,
   * and `message` asks the user to try again.
   */
  unverified?: boolean;
  message?: string;
  postOffices?: PostOfficeDetail[];
}

/**
 * Validates Indian PIN code format and performs live postal verification lookup via Postal PIN Code API
 */
export async function validatePincode(
  pincode: string,
  isIndianFormat: boolean = true
): Promise<PincodeValidationResult> {
  const pin = (pincode || '').trim();
  if (!pin) {
    return { isValid: false, message: 'PIN code is required' };
  }

  // International postal codes allowed if not 6-digit number or explicitly non-Indian
  if (!isIndianFormat || !/^\d+$/.test(pin)) {
    if (PINCODE_PATTERN.test(pin)) {
      return { isValid: true };
    }
    return { isValid: false, message: 'Invalid postal code format' };
  }

  // Format check for Indian 6-digit PIN code
  if (!INDIAN_PINCODE_PATTERN.test(pin)) {
    return {
      isValid: false,
      message: 'PIN Code must be 6 digits and cannot start with 0',
    };
  }

  // Dummy PIN code detection
  if (isDummyPincode(pin)) {
    return {
      isValid: false,
      message: 'Invalid test or sequential PIN code. Enter a valid postal code.',
    };
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const controller = new AbortController();
    timeout = setTimeout(() => controller.abort(), 6000);
    const response = await fetch(`https://api.postalpincode.in/pincode/${pin}`, {
      signal: controller.signal,
    });

    if (!response.ok) {
      return { isValid: false, unverified: true, message: UI_STRINGS.pincodeVerification.unverified };
    }

    const data = await response.json();
    if (Array.isArray(data) && data.length > 0 && data[0].Status === 'Success') {
      return {
        isValid: true,
        postOffices: data[0].PostOffice || [],
      };
    } else if (!Array.isArray(data)) {
      return { isValid: false, unverified: true, message: UI_STRINGS.pincodeVerification.unverified };
    } else {
      return {
        isValid: false,
        message: UI_STRINGS.pincodeVerification.notFound,
      };
    }
  } catch (error) {
    return { isValid: false, unverified: true, message: UI_STRINGS.pincodeVerification.unverified };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

/**
 * City and state from the postal office records returned for a PIN code.
 *
 * Returns '' when no office record is available, so the caller leaves the location blank.
 * The location is never guessed from the PIN digits. An office whose Pincode matches the
 * requested PIN is preferred over the first record.
 */
export function resolveLocationFromPostalResult(
  pincode: string,
  offices?: PostOfficeDetail[]
): string {
  if (!offices || offices.length === 0) return '';
  const office = offices.find((candidate) => candidate.Pincode === pincode) ?? offices[0];
  const city = office.District || office.Division || office.Circle || office.Name || '';
  const state = office.State || '';
  return [city, state].filter(Boolean).join(', ');
}

/** Public vendor directory search/filter query parameter limits. */
export const PUBLIC_VENDOR_QUERY_SCHEMA = {
  search: { maxLength: 200 },
  category: { maxLength: 200 },
  state: { maxLength: 100 },
  pageSize: { min: 1, max: 100 },
  page: { min: 1 },
  minRating: { min: 0, max: 5 },
  verifiedOnly: { type: 'boolean' },
} as const;

/** Indian states list for the public vendor directory state filter. */
export const INDIAN_STATES: readonly string[] = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
  'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand',
  'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur',
  'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab',
  'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
  'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry',
];

/** Vendor directory login passkey validation boundaries. */
export const VENDOR_DIRECTORY_AUTH_SCHEMA = {
  passkey: { minLength: 1, maxLength: 100 },
} as const;


/** Payment dues communication validation schemas */
export const PAYMENT_DUES_COMMUNICATION_SCHEMA = {
  email: {
    recipientEmail: { minLength: 5, maxLength: 255, pattern: EMAIL_PATTERN },
    subject: { minLength: 3, maxLength: 255 },
    message: { minLength: 5, maxLength: 5000 },
  },
  message: {
    message: { minLength: 5, maxLength: 5000 },
  },
  whatsapp: {
    phone: { minLength: 8, maxLength: 20 },
    message: { minLength: 5, maxLength: 5000 },
  },
  acknowledgement: {
    acknowledgementStatus: {
      allowed: [
        'Not Notified',
        'Notification Sent',
        'Delivery Pending',
        'Delivered',
        'Acknowledgement Pending',
        'Acknowledged',
        'Failed',
      ],
    },
    notes: { maxLength: 2000 },
  },
} as const;

/** Action Center Activity Log validation schema */
export const ACTIVITY_LOG_SCHEMA = {
  channel: {
    allowed: ['CALL', 'EMAIL', 'SMS', 'WHATSAPP'] as const,
  },
  subject: {
    minLength: 1,
    maxLength: 255,
  },
  message: {
    minLength: 1,
    maxLength: 5000,
  },
  callOutcome: {
    allowed: ['Connected', 'Left Voicemail', 'Busy', 'No Answer', 'Wrong Number'] as const,
  },
  followupPriority: {
    allowed: ['Low', 'Medium', 'High', 'Critical'] as const,
  },
} as const;


/** Internal task validation schema */
export const INTERNAL_TASK_SCHEMA = {
  title: { minLength: 2, maxLength: 512 },
  description: { maxLength: 5000 },
  notes: { maxLength: 2000 },
  creditQuantity: { min: 0 },
} as const;
/** Account Document Upload validation schema */
export const ACCOUNT_DOCUMENT_UPLOAD_SCHEMA = {
  documentName: { minLength: 1, maxLength: 255 },
  category: {
    allowed: [
      'Registration',
      'Company Profile',
      'GST',
      'PAN',
      'RFQ',
      'Quotation',
      'Other',
    ] as const,
  },
  description: { maxLength: 2000 },
  maxFileSize: 25 * 1024 * 1024,
  allowedExtensions: ['.pdf', '.jpg', '.jpeg', '.png', '.doc', '.docx', '.xls', '.xlsx'] as const,
} as const;

/** Seller Add Quote Credits validation schema */
export const SELLER_ADD_QUOTE_CREDITS_SCHEMA = {
  amount: { min: 1, max: 5 },
  reason: { maxLength: 1000 },
} as const;

/**
 * Buyer credit approval request limits. Approver and initiator names are not listed here,
 * so no person's name is hardcoded in the validation rules.
 */
export const BUYER_CREDIT_APPROVAL_REQUEST_SCHEMA = {
  amount: { min: 1 },
  reason: { maxLength: 1000 },
} as const;

/** Request Vendor Evaluation validation schema */
export const REQUEST_VENDOR_EVALUATION_SCHEMA = {
  notes: { maxLength: 1000 },
} as const;
