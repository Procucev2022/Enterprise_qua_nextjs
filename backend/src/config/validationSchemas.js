/**
 * Centralized Input Validation Schemas for Enterprise Backend
 * Single source of truth for all API payload, query parameter, and entity boundaries.
 */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/i;
const PHONE_REGEX = /^[+]?[(]?[0-9]{1,4}[)]?[-\s./0-9]{7,15}$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BULK_IMPORT_SESSION_ID_REGEX = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|bulk-import-\d+-[a-z0-9]{1,12})$/i;
const VENDOR_BULK_INVITATION_MAX_IDS = 15;
const BOT_EMAIL_RECIPIENT_LIMIT = 50;
const BOT_EMAIL_ATTACHMENT_LIMIT = 10;
const BOT_EMAIL_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
const BOT_EMAIL_ATTACHMENT_MAX_BASE64_LENGTH = Math.ceil(BOT_EMAIL_ATTACHMENT_MAX_BYTES / 3) * 4;
const BASE64_CONTENT_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;
const BOT_EMAIL_BODY_MAX_LENGTH = 1_000_000;
const { BOT_BRIDGE_CONFIG } = require('./botBridgeConfig');

// Approver names come from APPROVER_CONFIG in constants.js. constants.js loads this module
// at its own top level, so the lookup is deferred until validation runs to avoid a cycle.
function getCreditApproverNames() {
  return require('./constants').CREDIT_APPROVAL_APPROVERS;
}

// Chaser channel names come from BATCH_CHASER_CHANNELS in constants.js, read the same deferred way.
function getBatchChaserChannels() {
  return require('./constants').BATCH_CHASER_CHANNELS;
}

function validateBotEmailAddressList(value, required) {
  const addresses = Array.isArray(value) ? value : [value];
  if (required && addresses.length === 0) return 'At least one email recipient is required.';
  if (addresses.length > BOT_EMAIL_RECIPIENT_LIMIT) {
    return `Use no more than ${BOT_EMAIL_RECIPIENT_LIMIT} email recipients in one message.`;
  }
  if (addresses.some((address) => typeof address !== 'string'
    || address.trim().length > 320
    || !EMAIL_REGEX.test(address.trim()))) {
    return 'Every recipient must be a valid email address.';
  }
  return null;
}

function validateBotEmailAttachments(value) {
  if (!Array.isArray(value)) return 'Attachments must be a list.';
  if (value.length > BOT_EMAIL_ATTACHMENT_LIMIT) {
    return `Attach no more than ${BOT_EMAIL_ATTACHMENT_LIMIT} files.`;
  }
  for (const attachment of value) {
    if (!attachment || typeof attachment !== 'object' || Array.isArray(attachment)) {
      return 'Each attachment must include a filename, content type, and base64 file data.';
    }
    if (Object.keys(attachment).some((field) => !['fileName', 'contentType', 'fileData'].includes(field))) {
      return 'Attachment fields are limited to filename, content type, and base64 file data.';
    }
    const { fileName, contentType, fileData } = attachment;
    if (typeof fileName !== 'string' || fileName.trim().length === 0 || fileName.length > 255) {
      return 'Attachment filenames must be between 1 and 255 characters.';
    }
    if (typeof contentType !== 'string' || contentType.trim().length === 0 || contentType.length > 255) {
      return 'Attachment content types must be between 1 and 255 characters.';
    }
    if (typeof fileData !== 'string' || fileData.length === 0) {
      return 'Attachment file data must be valid base64.';
    }
    if (fileData.length > BOT_EMAIL_ATTACHMENT_MAX_BASE64_LENGTH) {
      return `Each attachment must be ${BOT_EMAIL_ATTACHMENT_MAX_BYTES / (1024 * 1024)} MB or smaller.`;
    }
    if (fileData.length % 4 !== 0 || !BASE64_CONTENT_PATTERN.test(fileData)) {
      return 'Attachment file data must be valid base64.';
    }
    const decodedBytes = Math.floor(fileData.length * 3 / 4) - (fileData.endsWith('==') ? 2 : fileData.endsWith('=') ? 1 : 0);
    if (decodedBytes > BOT_EMAIL_ATTACHMENT_MAX_BYTES) {
      return `Each attachment must be ${BOT_EMAIL_ATTACHMENT_MAX_BYTES / (1024 * 1024)} MB or smaller.`;
    }
  }
  return null;
}

// Delivery pincode or zipcode. Broader than an Indian six-digit PIN because the
// same field carries international zipcodes for export orders, which are
// alphanumeric and may contain a space or hyphen. Mirrors PINCODE_PATTERN in
// frontend/lib/validationSchemas.ts.
const PINCODE_REGEX = /^[A-Za-z0-9][A-Za-z0-9\s-]{2,9}$/;

const DUMMY_PINCODES = new Set([
  '000000', '111111', '222222', '333333', '444444',
  '555555', '666666', '777777', '888888', '999999',
  '012345', '123456', '234567', '345678', '456789', '567890',
  '654321', '765432', '876543', '987654', '098765',
  '121212', '212121', '123123', '321321', '000001', '100000',
]);

function isDummyPincode(pincode) {
  if (!pincode) return false;
  const clean = String(pincode).trim().replace(/\s+/g, '');
  if (!clean) return false;
  if (DUMMY_PINCODES.has(clean)) return true;
  if (/^(\d)\1{5,}$/.test(clean)) return true;
  return false;
}

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

const PROCUCEV_EMAIL_REGEX = /^[A-Za-z0-9._%+-]+@procucev\.com$/i;
const PROCUCEV_EMAIL_MESSAGE = 'Enter a valid corporate Procucev email address ending in @procucev.com.';

// Shortest password accepted when an account holder changes their own password.
// Mirrors PASSWORD_MIN_LENGTH in frontend/lib/constants.ts, which also drives the
// `minLength` attribute on the field, so the browser hint and this boundary
// cannot disagree. Deliberately not applied to sign-in: existing accounts
// migrated from the previous schema may hold shorter passwords, and rejecting
// them at login would lock those users out instead of prompting a change.
const PASSWORD_MIN_LENGTH = 8;
const CLIENT_LOG_LIMITS = Object.freeze({
  MESSAGE_LENGTH: 5000,
  CATEGORY_LENGTH: 100,
  STACK_TRACE_LENGTH: 12000,
  METADATA_KEYS: 100,
});

// ------------------------------------------------------------------------------
// VENDOR MASTER & PO DATA INGESTION
// ------------------------------------------------------------------------------
// Calendar date in YYYY-MM-DD. Every date crossing this boundary — the selected
// time horizon and each PO date — is normalised to this one format by the
// client's spreadsheet reader before it is submitted, so the server never has to
// guess between DD/MM/YYYY and MM/DD/YYYY. Guessing is exactly how a PO ends up
// filtered into the wrong horizon and a supplier classified from the wrong spend.
const ISO_DATE_REGEX = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;
const ISO_DATE_MESSAGE = 'Date must be a calendar date in YYYY-MM-DD format, for example 2024-04-01.';
const TIME_HORIZON_TYPES = ['LAST_1_YEAR', 'LAST_2_YEARS', 'LAST_3_YEARS', 'CUSTOM'];
const CATEGORY_REVIEW_ACTIONS = ['APPROVE', 'EDIT', 'REJECT'];
const DISPATCH_TEMPLATES = ['CATEGORY_MAPPED', 'SELF_MAP_REQUIRED', 'GENERAL_ONBOARDING'];

// ------------------------------------------------------------------------------
// STATUTORY IDENTIFIERS (buyer organisation profile)
// ------------------------------------------------------------------------------
// The Java p2pservices app validates none of these — PAN, CIN and website were
// free text and only GSTIN was checked, and then only in the Angular client. A
// malformed GSTIN therefore reached the `organization` table and broke downstream
// tax reporting. These are enforced here so an invalid identifier is rejected at
// the API boundary regardless of which client submitted it.

// Income-tax PAN: five letters, four digits, one letter.
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/i;
const PAN_MESSAGE = 'PAN must be 10 characters in the format AAAAA9999A, for example AAACL1234F.';

// MCA Corporate Identity Number: listing status, 5-digit industry code, 2-letter
// state, 4-digit year, 3-letter ownership code, 6-digit registration number.
const CIN_REGEX = /^[LUu][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/i;
const CIN_MESSAGE =
  'CIN must be 21 characters in the format L99999AA9999AAA999999, for example L28920MH1946PLC004768.';

const GSTIN_MESSAGE =
  'GSTIN must be 15 characters in the format 99AAAAA9999A9Z9, for example 27AAACL1234F1Z5.';

// Corporate website. Deliberately requires an http(s) scheme so the value can be
// used directly as a link target without the caller having to guess a protocol.
const WEBSITE_REGEX = /^https?:\/\/[^\s/$.?#][^\s]*$/i;
const WEBSITE_MESSAGE = 'Website must be a full URL beginning http:// or https://, for example https://example.com.';

// Registered-office PIN code. Narrower than the delivery PINCODE_REGEX above:
// a buyer's registered address is an Indian statutory address, so it is exactly
// six digits and cannot begin with zero.
const INDIAN_PINCODE_REGEX = /^[1-9][0-9]{5}$/;
const INDIAN_PINCODE_MESSAGE = 'PIN code must be 6 digits and cannot start with 0, for example 400001.';

// Legal constitutions offered by the buyer profile screen. Anything else is a
// client that has drifted from the shared taxonomy, so it is rejected rather
// than written to `organization.type`.
const ORGANIZATION_TYPES = [
  'Public Limited',
  'Private Limited',
  'LLP',
  'Partnership',
  'Sole Proprietorship',
];

const INTERNAL_TASK_CATEGORY_ENUM = Object.freeze([
  'COMMUNICATION',
  'DEMO_SCHEDULING',
  'CREDIT_MANAGEMENT',
  'BUSINESS_DEVELOPMENT',
  'INTERNAL_OPERATIONS',
  'ONBOARDING',
]);

const INTERNAL_TASK_TYPE_ENUM = Object.freeze([
  'Phone Call',
  'SMS',
  'WhatsApp',
  'Email',
  'New Follow-up',
  'Existing Follow-up',
  'Schedule Demo',
  'Demo Scheduling',
  'Add Credits',
  'Delete Credits',
  'Delete / Deduct Credits',
  'Send Proposal',
  'Send Corporate Email',
  'Operational Task',
  'Internal Operations',
  'Custom Task',
  'Client Onboarding',
  'Onboarding Process',
  'Quotation Review',
]);

const VALIDATION_SCHEMAS = {
  requestVendorEvaluation: {
    notes: { type: 'string', required: false, maxLength: 1000 },
  },
  clientLogEntry: {
      level: { type: 'string', required: false, enum: ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL', 'AUDIT'] },
    message: {
      type: 'string', required: true, minLength: 1, maxLength: CLIENT_LOG_LIMITS.MESSAGE_LENGTH,
      message: 'Log message is required.',
    },
    category: { type: 'string', required: false, maxLength: CLIENT_LOG_LIMITS.CATEGORY_LENGTH },
    stackTrace: { type: 'string', required: false, maxLength: CLIENT_LOG_LIMITS.STACK_TRACE_LENGTH },
    metadata: {
      type: 'object',
      required: false,
      custom: (value) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          return 'metadata must be a JSON object.';
        }
        if (Object.keys(value).length > CLIENT_LOG_LIMITS.METADATA_KEYS) {
          return `metadata must contain no more than ${CLIENT_LOG_LIMITS.METADATA_KEYS} fields.`;
        }
        return null;
      },
    },
  },
  createEnterpriseInquiry: {
    companyName: {
      type: 'string', required: true, minLength: 2, maxLength: 200,
      message: 'Company name must be 2 to 200 characters.',
    },
    email: {
      type: 'string', required: true, maxLength: 320, pattern: EMAIL_REGEX,
      message: 'Enter a valid corporate email address.',
    },
    mobile: {
      type: 'string', required: true, minLength: 8, maxLength: 32, pattern: PHONE_REGEX,
      message: 'Enter a valid mobile number including country code.',
    },
    notes: { type: 'string', required: false, maxLength: 2000 },
  },
  updateEnterpriseInquiry: {
    status: {
      type: 'string', required: false,
      enum: ['NEW', 'CONTACTED', 'IN_DISCUSSION', 'CONTRACT_SIGNED', 'CLOSED'],
      message: 'Choose a valid enterprise inquiry status.',
    },
    notes: { type: 'string', required: false, maxLength: 2000 },
  },
  listEnterpriseInquiries: {
    limit: {
      type: 'number', required: false, min: 1, max: 500,
      custom: (value) => Number.isInteger(Number(value)) ? null : 'Limit must be a whole number.',
    },
  },
  enterpriseInquiryId: {
    id: { type: 'string', required: true, minLength: 1, maxLength: 64 },
  },
  enterpriseInquiryIdempotencyKey: {
    idempotencyKey: {
      type: 'string', required: true, maxLength: 36, pattern: UUID_REGEX,
      message: 'Idempotency-Key must be a UUID.',
    },
  },
  requestVendorCategoryUpdate: {
    idempotencyKey: {
      type: 'string', required: false, maxLength: 36, pattern: UUID_REGEX,
      message: 'Idempotency key must be a UUID.',
    },
    vendorId: { type: 'string', required: false, minLength: 1, maxLength: 128 },
    vendorEmail: {
      type: 'string', required: false, maxLength: 320, pattern: EMAIL_REGEX,
      message: 'Enter a valid vendor email address.',
    },
    vendorName: { type: 'string', required: false, maxLength: 512 },
    rfqCategory: { type: 'string', required: false, maxLength: 1000 },
    rfqTitle: { type: 'string', required: false, maxLength: 200 },
    rfqNumber: { type: 'string', required: false, maxLength: 120 },
  },
  accountDocumentUpload: {
    documentName: { type: 'string', required: true, minLength: 1, maxLength: 255, message: 'Document name is required.' },
    category: { type: 'string', required: true, minLength: 1, maxLength: 64, message: 'Valid document category is required.' },
    fileName: { type: 'string', required: true, minLength: 1, maxLength: 255, message: 'File name is required.' },
    fileSize: { type: 'number', required: false, min: 0, max: 26214400, message: 'File size must not exceed 25MB.' },
    description: { type: 'string', required: false, maxLength: 2000 },
    fileUrl: { type: 'string', required: false },
    mimeType: { type: 'string', required: false },
  },

  sellerAddQuoteCredits: {
    amount: {
      type: 'number',
      required: true,
      min: 1,
      max: 5,
      custom: (val) => (!Number.isInteger(Number(val)) || Number(val) < 1 || Number(val) > 5 ? 'Quote credits must be an integer between 1 and 5.' : null),
      message: 'Quote credits must be an integer between 1 and 5.',
    },
    reason: { type: 'string', required: false, maxLength: 500 },
  },

  buyerCreditApprovalRequest: {
    idempotencyKey: {
      type: 'string', required: false, maxLength: 36, pattern: UUID_REGEX,
      message: 'Idempotency key must be a UUID.',
    },
    amount: {
      type: 'number',
      required: true,
      min: 1,
      max: 100000,
      custom: (val) => (!Number.isInteger(Number(val)) || Number(val) < 1 ? 'Credit amount must be a positive integer.' : null),
      message: 'Credit amount must be a positive integer.',
    },
    reason: { type: 'string', required: false, maxLength: 1000 },
    // The maker is the signed-in account (buyerAccountController), so no initiator name is
    // accepted from the request body.
    approverName: {
      type: 'string',
      required: true,
      get enum() {
        return getCreditApproverNames();
      },
      message: 'Approver must be one of the configured approvers.',
    },
  },

  sendPaymentDuesEmail: {
    accountId: { type: 'string', required: true, minLength: 1 },
    accountType: { type: 'string', required: true, enum: ['buyer', 'seller'] },
    recipientEmail: { type: 'string', required: true, pattern: EMAIL_REGEX, message: 'Valid recipient email address is required.' },
    subject: { type: 'string', required: true, minLength: 3, maxLength: 255, message: 'Email subject is required (3 to 255 characters).' },
    message: { type: 'string', required: true, minLength: 5, maxLength: 5000, message: 'Email message is required (5 to 5000 characters).' },
  },

  sendPaymentDuesMessage: {
    accountId: { type: 'string', required: true, minLength: 1 },
    accountType: { type: 'string', required: true, enum: ['buyer', 'seller'] },
    title: { type: 'string', required: false, maxLength: 255 },
    message: { type: 'string', required: true, minLength: 5, maxLength: 5000, message: 'Notification message is required (5 to 5000 characters).' },
  },

  sendPaymentDuesWhatsApp: {
    accountId: { type: 'string', required: true, minLength: 1 },
    accountType: { type: 'string', required: true, enum: ['buyer', 'seller'] },
    phone: { type: 'string', required: true, minLength: 8, message: 'Valid recipient phone number is required.' },
    message: { type: 'string', required: true, minLength: 5, maxLength: 5000, message: 'WhatsApp message is required (5 to 5000 characters).' },
  },

  updatePaymentDuesAcknowledgement: {
    accountId: { type: 'string', required: true, minLength: 1 },
    accountType: { type: 'string', required: true, enum: ['buyer', 'seller'] },
    acknowledgementStatus: {
      type: 'string',
      required: true,
      enum: [
        'Not Notified',
        'Notification Sent',
        'Delivery Pending',
        'Delivered',
        'Acknowledgement Pending',
        'Acknowledged',
        'Failed',
      ],
      message: 'Valid acknowledgement status is required.',
    },
    notes: { type: 'string', required: false, maxLength: 2000 },
  },

  createRFQ: {
    title: { type: 'string', required: true, minLength: 3, maxLength: 200 },
    // A buyer may not know the exact taxonomy slot for every line item up
    // front (see ingestion-wizard.tsx / manualRfqModel.ts) — an RFQ dispatched
    // with no line item categorized ends up with no derivable top-level
    // category either, and that must not block dispatch. storeService.createRFQ
    // already handles a missing category (falls back to null / per-line-item
    // signals), so nothing downstream assumes this is always present.
    category: { type: 'string', required: false, minLength: 2 },
    // Optional. A document that prices nothing yields no budget, and requiring
    // one forced the buyer to invent a ceiling vendors would then quote against.
    budget: { type: 'number', required: false, min: 0 },
    // Required, unlike budget. Vendors rate freight on the destination and its
    // pincode, so a quote raised without them cannot be compared against one
    // that has them. Enforced here as well as in the wizard so an RFQ posted
    // straight to the API cannot skip the destination.
    deliveryLocation: {
      type: 'string',
      required: true,
      minLength: 3,
      maxLength: 200,
      message: 'Delivery location is required and must be 3 to 200 characters.',
    },
    deliveryPincode: {
      type: 'string',
      required: true,
      pattern: PINCODE_REGEX,
      message: 'Pincode is required and must be 3 to 10 letters, digits, spaces or hyphens.',
      custom: (val) => (isDummyPincode(val) ? 'Dummy or sequential PIN codes (e.g. 123456, 111111) are not allowed.' : null),
    },
    // Metadata for documents already stored by POST /api/rfqs/attachments.
    attachments: { type: 'array', required: false },
    targetDeliveryDate: { type: 'string', required: true },
    lineItems: { type: 'array', required: false },
    // Provenance. Bounded here because these reach the stored record and are
    // rendered on the RFQ details screen; they were previously unvalidated
    // because storeService dropped them before they could be persisted at all.
    source: { type: 'string', required: false, maxLength: 40 },
    sourceFileName: { type: 'string', required: false, maxLength: 260 },
    sourceEmail: {
      type: 'string',
      required: false,
      pattern: EMAIL_REGEX,
      message: 'Source email must be a valid email address.',
    },
    targetGatewayEmail: {
      type: 'string',
      required: false,
      maxLength: 320,
      pattern: EMAIL_REGEX,
      message: 'Gateway notification address must be a valid email address.',
    },
    sharedBuyerAccountIds: { type: 'array', required: false },
    sharedBuyerEmails: { type: 'array', required: false },
  },

  // Edit of an existing RFQ (PUT /api/rfqs/:id).
  //
  // Every field is optional because an edit is a partial update: the buyer may be
  // correcting only the delivery pincode, and demanding the whole record back
  // would make a small correction able to blank whatever the form did not resend.
  // The format rules are identical to createRFQ, so a value that could not have
  // been created cannot be introduced by an edit either.
  //
  // Ownership fields are absent on purpose. rfqNumber, rfqId, buyer identity and
  // createdAt are not editable, and the query layer whitelists columns as well, so
  // sending them here changes nothing.
  updateRFQ: {
    title: { type: 'string', required: false, minLength: 3, maxLength: 200 },
    category: { type: 'string', required: false, minLength: 2 },
    status: { type: 'string', required: false, minLength: 2, maxLength: 40 },
    sourcingMode: { type: 'string', required: false, minLength: 2, maxLength: 20 },
    budget: { type: 'number', required: false, min: 0 },
    deliveryLocation: {
      type: 'string',
      required: false,
      minLength: 3,
      maxLength: 200,
      message: 'Delivery location must be 3 to 200 characters.',
    },
    deliveryPincode: {
      type: 'string',
      required: false,
      pattern: PINCODE_REGEX,
      message: 'Pincode must be 3 to 10 letters, digits, spaces or hyphens.',
      custom: (val) => (isDummyPincode(val) ? 'Dummy or sequential PIN codes (e.g. 123456, 111111) are not allowed.' : null),
    },
    targetDeliveryDate: { type: 'string', required: false },
    deadline: { type: 'string', required: false },
    closingDeadline: { type: 'string', required: false },
    isExtended: { type: 'boolean', required: false },
    extensionHours: { type: 'number', required: false },
    extendedAt: { type: 'string', required: false },
    extractedEntities: { type: 'array', required: false },
    attachments: { type: 'array', required: false },
    assignedVendors: { type: 'array', required: false },
  },

  // Schema for extending an RFQ closing deadline (strictly one-time, 24h or 48h)
  extendRFQ: {
    hours: {
      type: 'number',
      required: true,
      custom: (val) => ([24, 48].includes(Number(val)) ? null : 'Extension duration must be either 24 or 48 hours.'),
      message: 'Extension hours must be 24 or 48.',
    },
  },

  // Document handed to POST /api/rfqs/extract for Gemini line-item extraction.
  // Either documentText (client-flattened spreadsheet) or inlineData (PDF/image
  // base64) must be present; that either/or rule is enforced in the service,
  // which can report a precise reason the wizard shows to the buyer.
  extractRFQ: {
    fileName: { type: 'string', required: true, minLength: 1, maxLength: 260 },
    documentText: { type: 'string', required: false },
    inlineData: { type: 'string', required: false },
    // Preferred over inlineData for anything binary — a reference to a document
    // already uploaded raw via POST /api/rfqs/extract/stage, so the base64 body
    // never has to round-trip through this endpoint's JSON request at all.
    fileKey: { type: 'string', required: false, maxLength: 64 },
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

  // One row of a category manager's bulk vendor Excel upload (POST
  // /api/vendors/bulk-import). Mirrors the real p2pservices Vendor Master
  // sheet columns (Company Name, Person Name, Email Id, Mobile No, GSTIN, Pin
  // Code, City, State, Cate-1..5, Products) rather than the richer single-add
  // vendor form — the reference app's own bulk path only ever required
  // company name, email and mobile, so that's what's required here too;
  // everything else is format-checked only when the row actually supplies it.
  // A row failing any check here (a missing name/phone, or a malformed
  // email/phone/GSTIN/pincode) is not rejected — vendorController.
  // bulkImportVendors still imports it, tagged `hasIssues`/`issues`. The
  // marketplace-directory scrape this feeds from routinely has incomplete
  // real rows, and rejecting or fabricating a value for one both hide real
  // data from the CM reviewing the import; this schema only decides what
  // counts as "worth flagging," not what counts as "allowed to import."
  vendorBulkImportRow: {
    vendorCode: { type: 'string', required: false, maxLength: 100 },
    name: { type: 'string', required: false, minLength: 2, maxLength: 200, message: 'Company name is required.' },
    email: { type: 'string', required: false, pattern: EMAIL_REGEX, message: 'A valid email address is required.' },
    phone: { type: 'string', required: false, pattern: INDIAN_MOBILE_REGEX, message: INDIAN_MOBILE_MESSAGE },
    gstin: { type: 'string', required: false, pattern: GSTIN_REGEX, message: GSTIN_MESSAGE },
    pincode: { type: 'string', required: false, pattern: INDIAN_PINCODE_REGEX, message: INDIAN_PINCODE_MESSAGE },
    contactPerson: { type: 'string', required: false, maxLength: 150 },
    city: { type: 'string', required: false, maxLength: 100 },
    state: { type: 'string', required: false, maxLength: 100 },
    majorCategory: { type: 'string', required: false, maxLength: 150 },
    products: { type: 'string', required: false, maxLength: 500 },
  },

  vendorBulkImportRequest: {
    sessionId: {
      type: 'string',
      required: false,
      minLength: 1,
      maxLength: 64,
      pattern: BULK_IMPORT_SESSION_ID_REGEX,
      message: 'Import session ID must be a valid session identifier.',
    },
  },

  vendorBulkImportSessionParams: {
    sessionId: {
      type: 'string',
      required: true,
      minLength: 1,
      maxLength: 64,
      pattern: BULK_IMPORT_SESSION_ID_REGEX,
      message: 'Import session ID must be a valid session identifier.',
    },
  },

  vendorBulkImportInvitations: {
    vendorIds: {
      type: 'array',
      required: true,
      custom: (value) => {
        if (!Array.isArray(value) || value.length === 0) {
          return 'Select at least one imported vendor to invite.';
        }
        if (value.length > VENDOR_BULK_INVITATION_MAX_IDS) {
          return `Invite no more than ${VENDOR_BULK_INVITATION_MAX_IDS} vendors in one request.`;
        }
        const normalizedIds = value.map((id) => (typeof id === 'string' ? id.trim() : ''));
        if (normalizedIds.some((id) => !/^[a-z\d._:@-]{1,128}$/i.test(id))) {
          return 'Every vendor ID must be a valid identifier.';
        }
        if (new Set(normalizedIds.map((id) => id.toLowerCase())).size !== normalizedIds.length) {
          return 'Vendor IDs must be unique.';
        }
        return null;
      },
    },
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

  addBuyerCredit: {
    amount: {
      type: 'number', required: true, min: 1, max: 100000,
      custom: (value) => Number.isInteger(Number(value)) ? null : 'amount must be a whole number of credits.',
    },
    reason: { type: 'string', required: false, maxLength: 500 },
    source: { type: 'string', required: false, maxLength: 100 },
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
    isRegistration: { type: 'boolean', required: false },
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

  // Dedicated Category Manager Vendor Directory Email-OTP Schemas
  vendorDirectoryOtpRequest: {
    email: {
      type: 'string',
      required: true,
      pattern: PROCUCEV_EMAIL_REGEX,
      message: PROCUCEV_EMAIL_MESSAGE,
    },
  },

  vendorDirectoryOtpVerify: {
    email: {
      type: 'string',
      required: true,
      pattern: PROCUCEV_EMAIL_REGEX,
      message: PROCUCEV_EMAIL_MESSAGE,
    },
    code: {
      type: 'string',
      required: true,
      pattern: OTP_CODE_REGEX,
      message: OTP_CODE_MESSAGE,
    },
  },

  // Self-service password change, POST /api/auth/change-password.
  //
  // The caller is identified by the session token, so no email is accepted in
  // the body: a request can only ever change the password of the account it is
  // authenticated as. `minLength` is the only strength rule enforced here, and
  // it matches PASSWORD_MIN_LENGTH on the frontend so the browser hint and the
  // server boundary agree.
  changePassword: {
    newPassword: {
      type: 'string',
      required: true,
      minLength: PASSWORD_MIN_LENGTH,
      message: 'Choose a new password of at least 8 characters.',
    },
    currentPassword: {
      type: 'string',
      required: false,
      message: 'Enter your current password to authorise the change.',
    },
    code: {
      type: 'string',
      required: false,
    },
    verificationCode: {
      type: 'string',
      required: false,
    },
    resetToken: {
      type: 'string',
      required: false,
    },
  },

  register: {
    email: { type: 'string', required: true, message: 'Email is required for registration.' },
    name: { type: 'string', required: false },
    password: { type: 'string', required: false },
    mobile: { type: 'string', required: false, pattern: INDIAN_MOBILE_REGEX, message: INDIAN_MOBILE_MESSAGE },
    role: { type: 'string', required: false },
    orgName: { type: 'string', required: false },
    street: { type: 'string', required: false },
    address: { type: 'string', required: false },
    city: { type: 'string', required: false },
    state: { type: 'string', required: false },
    pincode: { type: 'string', required: false },
    country: { type: 'string', required: false },
    gstin: { type: 'string', required: false },
    gstNumber: { type: 'string', required: false },
    pan: { type: 'string', required: false },
    panNumber: { type: 'string', required: false },
    emailOtp: { type: 'string', required: false },
    mobileOtp: { type: 'string', required: false },
    code: { type: 'string', required: false },
  },

  // Mandatory first-login profile completion for automatically created buyers
  completeBuyerOnboarding: {
    emailOtp: { type: 'string', required: true, pattern: OTP_CODE_REGEX, message: 'Valid 6-digit email OTP is required.' },
    mobile: {
      type: 'string',
      required: true,
      pattern: INDIAN_MOBILE_REGEX,
      message: INDIAN_MOBILE_MESSAGE,
      custom: (val) => {
        const cleaned = String(val || '').replace(/\D/g, '');
        if (cleaned.endsWith('9999999999') || cleaned === '9999999999') {
          return 'Placeholder phone number 9999999999 must be replaced with your actual phone number.';
        }
        return null;
      },
    },
    mobileOtp: { type: 'string', required: true, pattern: OTP_CODE_REGEX, message: 'Valid 6-digit SMS OTP is required.' },
    currentPassword: { type: 'string', required: true, minLength: 1, message: 'Current temporary password is required.' },
    newPassword: { type: 'string', required: true, minLength: PASSWORD_MIN_LENGTH, message: 'New password of at least 8 characters is required.' },
    companyName: { type: 'string', required: true, minLength: 2, maxLength: 255, message: 'Company or organisation name is required.' },
    contactName: { type: 'string', required: false, maxLength: 255 },
    city: { type: 'string', required: false, maxLength: 255 },
    state: { type: 'string', required: false, maxLength: 255 },
    pincode: { type: 'string', required: false, pattern: INDIAN_PINCODE_REGEX, message: INDIAN_PINCODE_MESSAGE },
    address: { type: 'string', required: false, maxLength: 500 },
    street: { type: 'string', required: false, maxLength: 500 },
    gstin: { type: 'string', required: false, pattern: GSTIN_REGEX, message: GSTIN_MESSAGE },
    gstNumber: { type: 'string', required: false, pattern: GSTIN_REGEX, message: GSTIN_MESSAGE },
    pan: { type: 'string', required: false, pattern: PAN_REGEX, message: PAN_MESSAGE },
    panNumber: { type: 'string', required: false, pattern: PAN_REGEX, message: PAN_MESSAGE },
  },

  // Buyer organisation profile submitted by PUT /api/buyer-profile/me.
  //
  // Ported from the fields ProcUserServiceImpl.updateBuyer patches onto the
  // `organization` row. That method applies null-skip semantics — an omitted key
  // leaves the stored value untouched — so almost everything here is optional and
  // only the legal entity name, which identifies the organisation, is required.
  //
  // `email` and `contactPhone` are deliberately absent: they are owned by the
  // `user` row established at sign-in. The phone is also an authentication
  // factor, so it can only change through the verified phone-update flow.
  // `organizationPhonenumber` is an organization contact alias, not a profile
  // field; the service ignores all of these rather than letting profile saves
  // reassign login identity or authentication data.
  buyerProfile: {
    companyName: { type: 'string', required: true, minLength: 2, maxLength: 255, message: 'Legal entity name is required.' },
    brandName: { type: 'string', required: false, maxLength: 255 },
    organizationType: {
      type: 'string',
      required: false,
      enum: ORGANIZATION_TYPES,
    },
    panNumber: { type: 'string', required: false, pattern: PAN_REGEX, message: PAN_MESSAGE },
    gstNumber: { type: 'string', required: false, pattern: GSTIN_REGEX, message: GSTIN_MESSAGE },
    cinNumber: { type: 'string', required: false, pattern: CIN_REGEX, message: CIN_MESSAGE },
    website: { type: 'string', required: false, pattern: WEBSITE_REGEX, message: WEBSITE_MESSAGE },
    annualTurnover: { type: 'string', required: false, maxLength: 255 },
    street: { type: 'string', required: false, maxLength: 255 },
    city: { type: 'string', required: false, maxLength: 255 },
    state: { type: 'string', required: false, maxLength: 255 },
    pincode: { type: 'string', required: false, pattern: INDIAN_PINCODE_REGEX, message: INDIAN_PINCODE_MESSAGE },
    country: { type: 'string', required: false, maxLength: 255 },
    contactName: { type: 'string', required: false, maxLength: 255 },
    contactDesignation: { type: 'string', required: false, maxLength: 255 },
    // Flat [{ major, minor }] pairs, mirroring the org_division_category rows
    // they become. Cardinality limits are enforced in the service, which can
    // report which cap was exceeded.
    categories: { type: 'array', required: false },
  },
  // Category-manager/admin lookup fields for GET /api/buyer-profile/details.
  // Cross-field "at least one identifier" validation is applied at the route
  // boundary after each supplied value has been normalized and checked here.
  buyerProfileDetailsQuery: {
    email: {
      type: 'string', required: false, maxLength: 320, pattern: EMAIL_REGEX,
      message: 'Enter a valid buyer email address.',
    },
    name: {
      type: 'string', required: false, minLength: 1, maxLength: 255,
      message: 'Organization name must be between 1 and 255 characters.',
    },
    accountId: {
      type: 'string', required: false, minLength: 1, maxLength: 128,
      message: 'Account ID must be between 1 and 128 characters.',
    },
  },
  // The API-key-protected WhatsApp bot bridge accepts only these request fields.
  botBridgeSession: {
    id: { type: 'string', required: false, minLength: 1, maxLength: 128 },
    email: { type: 'string', required: false, maxLength: 320, pattern: EMAIL_REGEX, message: 'Enter a valid account email address.' },
    phone: { type: 'string', required: false, minLength: 8, maxLength: 32, pattern: PHONE_REGEX, message: 'Enter a valid account phone number.' },
  },
  botBridgePhoneQuery: {
    phone: { type: 'string', required: true, minLength: 8, maxLength: 32, pattern: PHONE_REGEX, message: 'Enter a valid account phone number.' },
  },
  botBridgeIdParams: {
    id: { type: 'string', required: true, minLength: 1, maxLength: 128 },
  },
  botBridgeWhatsAppStatus: {
    registeredViaWhatsApp: { type: 'boolean', required: true },
    verificationStatus: {
      type: 'string', required: false, enum: BOT_BRIDGE_CONFIG.VERIFICATION_STATES,
      message: 'Choose a supported WhatsApp verification status.',
    },
  },
  botBridgeOptOut: {
    optedOut: { type: 'boolean', required: true },
  },
  botBridgeEmail: {
    to: { type: 'any', required: true, custom: (value) => validateBotEmailAddressList(value, true) },
    cc: { type: 'any', required: false, custom: (value) => validateBotEmailAddressList(value) },
    bcc: { type: 'any', required: false, custom: (value) => validateBotEmailAddressList(value) },
    subject: { type: 'string', required: false, maxLength: 998 },
    text: { type: 'string', required: false, maxLength: BOT_EMAIL_BODY_MAX_LENGTH },
    html: { type: 'string', required: false, maxLength: BOT_EMAIL_BODY_MAX_LENGTH },
    attachments: { type: 'any', required: false, custom: validateBotEmailAttachments },
  },

  // ----------------------------------------------------------------------------
  // VENDOR MASTER & PO DATA INGESTION (buyer module)
  // ----------------------------------------------------------------------------
  // The time horizon the buyer selects before uploading anything. It decides
  // which PO rows the AI categoriser is allowed to see, so it is validated at
  // the boundary rather than trusted: a bad range would silently change which
  // spend history a supplier is classified from.
  //
  // startDate/endDate are only required for CUSTOM — the service resolves the
  // concrete range for the three predefined options itself, so a client cannot
  // claim "last 1 year" while supplying a five-year window.
  vendorIngestionTimeHorizon: {
    horizonType: {
      type: 'string',
      required: true,
      enum: TIME_HORIZON_TYPES,
      message: 'Select a time horizon of Last 1 Year, Last 2 Years, Last 3 Years or a custom date range.',
    },
    startDate: { type: 'string', required: false, pattern: ISO_DATE_REGEX, message: ISO_DATE_MESSAGE },
    endDate: { type: 'string', required: false, pattern: ISO_DATE_REGEX, message: ISO_DATE_MESSAGE },
  },

  // One Vendor Master row. Vendor Code and Company Name are the identity of the
  // supplier and are both required — a row missing either cannot be matched to
  // PO history or emailed, and is reported as invalid rather than defaulted.
  // Email is required because every mapped supplier is eventually mailed.
  vendorMasterRow: {
    vendorCode: { type: 'string', required: true, minLength: 1, maxLength: 120, message: 'Vendor Code is required.' },
    companyName: { type: 'string', required: true, minLength: 2, maxLength: 512, message: 'Company Name is required.' },
    email: { type: 'string', required: true, pattern: EMAIL_REGEX, message: 'A valid Email is required.' },
    contactPerson: { type: 'string', required: false, maxLength: 255 },
    phone: { type: 'string', required: false, pattern: PHONE_REGEX, message: 'Phone is not a valid contact number.' },
    address: { type: 'string', required: false, maxLength: 1024 },
    gstin: { type: 'string', required: false, pattern: GSTIN_REGEX, message: GSTIN_MESSAGE },
    // Optional 0-100 supplier score from the buyer's own ERP. Out-of-range
    // values are rejected, never clamped, so a mis-scaled column (a 0-5 rating
    // pasted into a 0-100 field) surfaces instead of being silently rewritten.
    rating: { type: 'number', required: false, min: 0, max: 100 },
  },

  // One historical PO line item. The description is the single most important
  // field in the whole module — it is the evidence the categoriser reads — so a
  // line with no description is invalid rather than merely unhelpful.
  poLineItemRow: {
    poNumber: { type: 'string', required: true, minLength: 1, maxLength: 120, message: 'PO Number is required.' },
    poDate: { type: 'string', required: true, pattern: ISO_DATE_REGEX, message: ISO_DATE_MESSAGE },
    itemDescription: {
      type: 'string',
      required: true,
      minLength: 2,
      maxLength: 4000,
      message: 'Line Item Description is required — it is the evidence the categoriser reads.',
    },
    quantity: { type: 'number', required: true, min: 0, message: 'Quantity is required.' },
    uom: { type: 'string', required: true, minLength: 1, maxLength: 64, message: 'UOM is required.' },
    spend: { type: 'number', required: true, min: 0, message: 'Spend / Amount is required.' },
    department: { type: 'string', required: true, minLength: 1, maxLength: 255, message: 'Department is required.' },
    // Either identifier is enough to join to the vendor master; the service
    // rejects a row that supplies neither, because it cannot be attributed.
    vendorCode: { type: 'string', required: false, maxLength: 120 },
    vendorName: { type: 'string', required: false, maxLength: 512 },
    vendorGstin: { type: 'string', required: false, pattern: GSTIN_REGEX, message: GSTIN_MESSAGE },
    specification: { type: 'string', required: false, maxLength: 4000 },
    materialCode: { type: 'string', required: false, maxLength: 120 },
    existingCategory: { type: 'string', required: false, maxLength: 255 },
    existingSubcategory: { type: 'string', required: false, maxLength: 255 },
    currency: { type: 'string', required: false, maxLength: 8 },
  },

  // A buyer's decision on one AI suggestion. The AI columns are never part of
  // this payload — approving or editing must not be able to rewrite what the
  // model proposed, which is the whole basis of the audit trail.
  vendorCategoryReview: {
    action: {
      type: 'string',
      required: true,
      enum: CATEGORY_REVIEW_ACTIONS,
      message: 'Review action must be APPROVE, EDIT or REJECT.',
    },
    majorCategory: { type: 'string', required: false, maxLength: 255 },
    minorCategories: { type: 'array', required: false },
  },

  // A dispatch request. Recipients are identified by their vendor-master record
  // id and re-resolved server-side — the email address is never taken from the
  // request, so a tampered payload cannot redirect a campaign to an outside
  // address.
  vendorIngestionDispatch: {
    template: {
      type: 'string',
      required: true,
      enum: DISPATCH_TEMPLATES,
      message: 'Select a CATEGORY_MAPPED, SELF_MAP_REQUIRED or GENERAL_ONBOARDING email template.',
    },
    majorCategory: { type: 'string', required: false, maxLength: 255 },
    vendorRecordIds: { type: 'array', required: false },
  },

  vendorHeartbeat: {
    identifier: { type: 'string', required: false, minLength: 1, maxLength: 255 },
    role: { type: 'string', required: false, minLength: 1, maxLength: 50 },
    status: { type: 'string', required: false, enum: ['online', 'offline'] },
  },

  vendorPresenceQuery: {
    identifiers: { type: 'string', required: false, maxLength: 2000 },
  },

  createAIFeedItem: {
    title: { type: 'string', required: true, minLength: 1, maxLength: 250 },
    message: { type: 'string', required: true, minLength: 1, maxLength: 5000 },
    type: {
      type: 'string', required: false,
      enum: ['call', 'whatsapp', 'sms', 'email', 'scoring', 'ingestion', 'escalation', 'approval', 'system', 'invitation', 'reminder'],
    },
    channel: {
      type: 'string', required: false,
      enum: ['call', 'whatsapp', 'sms', 'email', 'system', 'invitation', 'reminder'],
    },
    recipient: { type: 'string', required: false, maxLength: 255 },
    rfqNumber: { type: 'string', required: false, maxLength: 100 },
    buyerAccountId: { type: 'string', required: false, maxLength: 255 },
    channelDetails: {
      type: 'object',
      required: false,
      custom: (value) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          return 'channelDetails must be a JSON object.';
        }
        const allowedFields = ['duration', 'transcriptSummary', 'deliveryTimestamp', 'actionOutcome'];
        const unknownField = Object.keys(value).find((field) => !allowedFields.includes(field));
        if (unknownField) return `channelDetails.${unknownField} is not supported.`;
        const invalidField = Object.entries(value).find(([field, detail]) =>
          typeof detail !== 'string' || detail.length > (field === 'transcriptSummary' ? 2000 : 255)
        );
        return invalidField ? `channelDetails.${invalidField[0]} must be a string within its allowed length.` : null;
      },
    },
  },

  auditLogEntry: {
    action: { type: 'string', required: true, minLength: 1, maxLength: 5000 },
    rfqNumber: { type: 'string', required: false, maxLength: 100 },
  },

  // Public vendor directory — unauthenticated search/filter parameters
  vendorPublicSearch: {
    page: { type: 'number', required: false, min: 1 },
    pageSize: { type: 'number', required: false, min: 1, max: 100 },
    search: { type: 'string', required: false, maxLength: 200 },
    category: { type: 'string', required: false, maxLength: 200 },
    state: { type: 'string', required: false, maxLength: 100 },
    minRating: { type: 'number', required: false, min: 0, max: 5 },
    verifiedOnly: { type: 'boolean', required: false },
  },

  transactionalEmailPreview: {
    templateId: { type: 'string', required: true, minLength: 1, maxLength: 100, message: 'Template ID or number is required.' },
  },

  transactionalEmailSend: {
    templateId: { type: 'string', required: true, minLength: 1, maxLength: 100, message: 'Template ID or number is required.' },
    recipientEmail: { type: 'string', required: true, pattern: EMAIL_REGEX, message: 'A valid recipient email is required.' },
  },

  vendorDirectoryAuth: {
    passcode: { type: 'string', required: false, maxLength: 100 },
    accessKey: { type: 'string', required: false, maxLength: 100 },
    username: { type: 'string', required: false, maxLength: 100 },
    password: { type: 'string', required: false, maxLength: 100 },
  },

  ticketCreate: {
    subject: { type: 'string', required: true, minLength: 3, maxLength: 512, message: 'Ticket subject is required (minimum 3 characters).' },
    description: { type: 'string', required: false, maxLength: 5000 },
    priority: { type: 'string', required: false, enum: ['Critical', 'High', 'Medium', 'Low'] },
    status: { type: 'string', required: false, enum: ['Pending', 'In Progress', 'Escalated', 'Completed'] },
    category: { type: 'string', required: false, maxLength: 100 },
    project: { type: 'string', required: false, maxLength: 255 },
    customerName: {
      type: 'string', required: true, minLength: 2, maxLength: 255,
      message: 'Customer name is required (2 to 255 characters).',
    },
    customerEmail: {
      type: 'string', required: true, maxLength: 320, pattern: EMAIL_REGEX,
      message: 'Customer email is required and must be a valid email address.',
    },
    customerPhone: {
      type: 'string', required: true, minLength: 8, maxLength: 32, pattern: PHONE_REGEX,
      message: 'Customer phone is required and must be a valid phone number (8 to 32 characters).',
    },
    assignedToName: {
      type: 'string', required: true, minLength: 2, maxLength: 255,
      message: 'Assigned to name is required (2 to 255 characters).',
    },
    assignedTeam: { type: 'string', required: false, maxLength: 100 },
    dueDate: { type: 'string', required: false, maxLength: 64 },
  },

  ticketUpdate: {
    subject: { type: 'string', required: false, minLength: 3, maxLength: 512 },
    description: { type: 'string', required: false, maxLength: 5000 },
    priority: { type: 'string', required: false, enum: ['Critical', 'High', 'Medium', 'Low'] },
    status: { type: 'string', required: false, enum: ['Pending', 'In Progress', 'Escalated', 'Completed'] },
    category: { type: 'string', required: false, maxLength: 100 },
    project: { type: 'string', required: false, maxLength: 255 },
    assignedToName: { type: 'string', required: false, maxLength: 255 },
    assignedTeam: { type: 'string', required: false, maxLength: 100 },
    resolutionNotes: { type: 'string', required: false, maxLength: 5000 },
    dueDate: { type: 'string', required: false, maxLength: 64 },
  },

  ticketEscalate: {
    escalatedTo: { type: 'string', required: true, minLength: 2, maxLength: 255, message: 'Escalation target or manager name is required.' },
    reason: { type: 'string', required: true, minLength: 3, maxLength: 2000, message: 'A specific reason for escalation is required.' },
  },

  ticketComment: {
    comment: { type: 'string', required: true, minLength: 1, maxLength: 5000, message: 'Comment text cannot be empty.' },
  },

  // Channels for POST /api/rfqs/:id/batch-chaser. The request must name at least one channel,
  // each channel at most once, and no more channels than BATCH_CHASER_CHANNELS holds.
  batchChaserChannels: {
    channels: {
      type: 'array',
      required: true,
      message: 'Choose at least one chaser channel: call, whatsapp or sms.',
      custom: (value) => {
        const allowed = getBatchChaserChannels();
        if (!Array.isArray(value) || value.length === 0) {
          return `Choose at least one chaser channel: ${allowed.join(', ')}.`;
        }
        if (value.length > allowed.length) {
          return `Choose no more than ${allowed.length} chaser channels.`;
        }
        const unsupported = value.filter((channel) => !allowed.includes(channel));
        if (unsupported.length > 0) {
          return `Chaser channel "${String(unsupported[0])}" is not supported. Use ${allowed.join(', ')}.`;
        }
        if (new Set(value).size !== value.length) {
          return 'Each chaser channel can be chosen only once.';
        }
        return null;
      },
    },
  },

  approvalAction: {
    action: { type: 'string', required: true, enum: ['APPROVE', 'REJECT', 'Approve', 'Reject', 'approved', 'rejected'], message: 'Action must be APPROVE or REJECT.' },
    remarks: { type: 'string', required: false, maxLength: 1000 },
    password: { type: 'string', required: true, minLength: 1, message: 'Approver password confirmation is required.' },
    approverName: {
      type: 'string',
      required: true,
      get enum() {
        return getCreditApproverNames();
      },
      message: 'Select the approver whose password you are confirming.',
    },
  },

  registrationList: {
    search: { type: 'string', required: false, maxLength: 200 },
    clientType: { type: 'string', required: false, enum: ['all', 'buyer', 'seller'] },
    sourceType: {
      type: 'string',
      required: false,
      enum: ['all', 'All', 'web app', 'Web App', 'WhatsApp', 'whatsapp', 'Email', 'email'],
    },
    status: {
      type: 'string',
      required: false,
      enum: ['all', 'All', 'new', 'New', 'accepted', 'Accepted', 'rejected', 'Rejected'],
    },
    limit: { type: 'number', required: false, min: 1, max: 200 },
    offset: { type: 'number', required: false, min: 0, max: 1000000 },
  },

  registrationAction: {
    action: { type: 'string', required: true, enum: ['accept', 'reject', 'ACCEPT', 'REJECT', 'Accept', 'Reject'], message: 'Action must be accept or reject.' },
    remarks: { type: 'string', required: false, maxLength: 1000 },
  },

  actionCenterCommunicationSend: {
    entityType: {
      type: 'string',
      required: true,
      enum: [
        'internal_task',
        'ticket',
        'approval',
        'buyer_dossier',
        'supplier_dossier',
        'payment_due',
        'registration',
        'general',
      ],
      message: 'A valid entityType is required.',
    },
    entityId: {
      type: 'string',
      required: true,
      minLength: 1,
      maxLength: 128,
      message: 'entityId is required.',
    },
    channel: {
      type: 'string',
      required: true,
      enum: ['EMAIL', 'SMS', 'BOTH', 'email', 'sms', 'both'],
      message: 'Channel must be EMAIL, SMS, or BOTH.',
    },
    recipientEmail: {
      type: 'string',
      required: false,
      maxLength: 255,
      pattern: EMAIL_REGEX,
      message: 'A valid recipient email address is required.',
    },
    recipientPhone: {
      type: 'string',
      required: false,
      maxLength: 32,
      pattern: INDIAN_MOBILE_REGEX,
      message: INDIAN_MOBILE_MESSAGE,
    },
    recipientName: {
      type: 'string',
      required: false,
      maxLength: 255,
    },
    subject: {
      type: 'string',
      required: false,
      maxLength: 512,
    },
    message: {
      type: 'string',
      required: true,
      minLength: 1,
      maxLength: 5000,
      message: 'Message content is required.',
    },
    templateId: {
      type: 'string',
      required: false,
      maxLength: 128,
    },
    linkUrl: {
      type: 'string',
      required: false,
      maxLength: 2048,
    },
    scheduleFollowup: {
      type: 'object',
      required: false,
      custom: (val) => {
        if (!val) return null;
        if (typeof val !== 'object' || Array.isArray(val)) {
          return 'scheduleFollowup must be a valid object.';
        }
        if (!val.dueDate) {
          return 'scheduleFollowup.dueDate is required.';
        }
        const d = new Date(val.dueDate);
        if (isNaN(d.getTime())) {
          return 'scheduleFollowup.dueDate must be a valid date.';
        }
        if (val.priority && !['Low', 'Medium', 'High', 'Critical', 'Urgent'].includes(val.priority)) {
          return 'scheduleFollowup.priority must be one of: Low, Medium, High, Critical, Urgent.';
        }
        return null;
      },
    },
    notes: {
      type: 'string',
      required: false,
      maxLength: 2000,
    },
  },

  actionCenterCommunicationQuery: {
    entityType: { type: 'string', required: false, maxLength: 64 },
    entityId: { type: 'string', required: false, maxLength: 128 },
    channel: { type: 'string', required: false, maxLength: 32 },
    page: { type: 'number', required: false, min: 1 },
    pageSize: { type: 'number', required: false, min: 1, max: 100 },
  },

  createInternalTask: {
    title: {
      type: 'string',
      required: true,
      minLength: 2,
      maxLength: 512,
      message: 'Task title must be between 2 and 512 characters.',
    },
    taskCategory: {
      type: 'string',
      required: false,
      enum: INTERNAL_TASK_CATEGORY_ENUM,
      message: 'Invalid taskCategory. Must be one of the defined internal task categories.',
    },
    taskType: {
      type: 'string',
      required: false,
      enum: INTERNAL_TASK_TYPE_ENUM,
      message: 'Invalid taskType. Must be one of the defined task types.',
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
    assignedToName: {
      type: 'string',
      required: false,
    },
    dueDate: {
      type: 'string',
      required: false,
    },
    creditQuantity: {
      type: 'number',
      required: false,
      min: 0,
    },
  },

  updateInternalTask: {
    title: {
      type: 'string',
      required: false,
      minLength: 2,
      maxLength: 512,
    },
    taskCategory: {
      type: 'string',
      required: false,
      enum: INTERNAL_TASK_CATEGORY_ENUM,
      message: 'Invalid taskCategory. Must be one of the defined internal task categories.',
    },
    taskType: {
      type: 'string',
      required: false,
      enum: INTERNAL_TASK_TYPE_ENUM,
      message: 'Invalid taskType. Must be one of the defined task types.',
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

  sendDailyRfqReport: {
    targetDate: {
      type: 'string',
      required: false,
      pattern: /^\d{4}-\d{2}-\d{2}$/,
      message: 'targetDate must be a valid date in YYYY-MM-DD format if provided.',
    },
    recipients: {
      type: 'array',
      required: false,
      message: 'recipients must be an array of email strings.',
    },
    dryRun: {
      type: 'boolean',
      required: false,
    },
  },
};



/**
 * Universal Schema Validator
 * Validates a payload against a defined schema and returns structured field errors.
 */
function validatePayload(schema, data = {}) {
  const errors = {};
  const sanitized = {};

  const targetSchema = typeof schema === 'string' ? VALIDATION_SCHEMAS[schema] : schema;
  if (!targetSchema || typeof targetSchema !== 'object') {
    return { isValid: true, errors: {}, sanitizedData: data };
  }

  for (const [field, rules] of Object.entries(targetSchema)) {
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
        if (rules.custom && typeof rules.custom === 'function') {
          const customError = rules.custom(str);
          if (customError) {
            errors[field] = customError;
            continue;
          }
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
      } else if (rules.type === 'boolean') {
        if (typeof value !== 'boolean') {
          errors[field] = `${field} must be true or false.`;
          continue;
        }
        sanitized[field] = value;
      } else {
        sanitized[field] = value;
      }

      if (rules.custom && typeof rules.custom === 'function' && rules.type !== 'string') {
        const customError = rules.custom(value);
        if (customError) {
          errors[field] = customError;
        }
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
  PROCUCEV_EMAIL_REGEX,
  PROCUCEV_EMAIL_MESSAGE,
  PINCODE_REGEX,
  DUMMY_PINCODES,
  isDummyPincode,
  GSTIN_REGEX,
  GSTIN_MESSAGE,
  PHONE_REGEX,
  UUID_REGEX,
  INDIAN_MOBILE_REGEX,
  INDIAN_MOBILE_MESSAGE,
  OTP_CODE_REGEX,
  OTP_CODE_MESSAGE,
  PASSWORD_MIN_LENGTH,
  CLIENT_LOG_LIMITS,
  PAN_REGEX,
  PAN_MESSAGE,
  CIN_REGEX,
  CIN_MESSAGE,
  WEBSITE_REGEX,
  WEBSITE_MESSAGE,
  INDIAN_PINCODE_REGEX,
  INDIAN_PINCODE_MESSAGE,
  ORGANIZATION_TYPES,
  ISO_DATE_REGEX,
  ISO_DATE_MESSAGE,
  TIME_HORIZON_TYPES,
  CATEGORY_REVIEW_ACTIONS,
  DISPATCH_TEMPLATES,
  VALIDATION_SCHEMAS,
  validatePayload,
  VENDOR_BULK_INVITATION_MAX_IDS,
};
