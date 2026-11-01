/**
 * Centralized Backend Data Types & JSDoc Contracts
 * Single source of truth for domain entity shapes, payload structures, and resolver interfaces.
 */

/**
 * @typedef {Object} RFQItemEntity
 * @property {string} id
 * @property {string} rfqNumber
 * @property {string} title
 * @property {string} category
 * @property {string} intakeSource
 * @property {string} creationDate
 * @property {string} targetDeliveryDate
 * @property {number} budget optional ceiling; 0 means the buyer stated none
 * @property {string} [deliveryLocation] where the goods must be delivered
 * @property {string} [deliveryPincode] postal code for the delivery location
 * @property {number} quotesCount
 * @property {string} status
 * @property {boolean} chasingActive
 * @property {Array<Object>} quotes
 * @property {Array<Object>} lineItems
 * @property {number} [procucevVendorCount]
 */

/**
 * @typedef {Object} VendorEntity
 * @property {string} id
 * @property {string} name
 * @property {string} corporateEmail
 * @property {string} gstin
 * @property {string} majorCategory
 * @property {number} compositeRating
 * @property {string} status
 */

/**
 * @typedef {Object} EncryptedPayloadEntity
 * @property {string} ciphertext
 * @property {string} iv
 * @property {string} authTag
 * @property {string} [salt]
 * @property {string} algorithm
 * @property {string} version
 * @property {string} [encoded]
 */

/**
 * @typedef {Object} CryptoHealthStatusEntity
 * @property {string} status
 * @property {string} algorithm
 * @property {number} keyLengthBits
 * @property {boolean} roundtripVerified
 * @property {boolean} tamperDetectionVerified
 * @property {string} timestamp
 */

/**
 * @typedef {Object} ActionCenterCommunicationEntity
 * @property {string} id
 * @property {'internal_task'|'ticket'|'approval'|'buyer_dossier'|'supplier_dossier'|'payment_due'|'registration'} entityType
 * @property {string} entityId
 * @property {'EMAIL'|'SMS'|'BOTH'} channel
 * @property {string} recipient
 * @property {string} recipientName
 * @property {string} subject
 * @property {string} message
 * @property {'Pending'|'Dispatched'|'Delivered'|'Failed'|'Acknowledged'} deliveryStatus
 * @property {string} communicatedBy
 * @property {string} createdAt
 */

const DOMAIN_TYPES = {
  ACTION_CENTER_CHANNELS: ['EMAIL', 'SMS', 'BOTH'],
  ACTION_CENTER_ENTITY_TYPES: [
    'internal_task',
    'ticket',
    'approval',
    'buyer_dossier',
    'supplier_dossier',
    'payment_due',
    'registration',
  ],
  RFQ_STATUSES: ['Ingested', 'Dispatched', 'In Evaluation', 'Quotes Pending', 'PO Awarded'],
  SOURCING_MODES: ['mode_0', 'mode_1', 'mode_2', 'mode_3'],
  SEVERITY_LEVELS: ['INFO', 'WARN', 'ERROR', 'CRITICAL'],
  AUDIT_CATEGORIES: ['SECURITY', 'DATA_MUTATION', 'SYSTEM', 'AUTHENTICATION', 'PERFORMANCE', 'CRYPTOGRAPHY'],
  CIPHER_ALGORITHMS: ['aes-256-gcm', 'aes-256-cbc'],
  QUA_AI_EMAIL_TEMPLATE_KEYS: [
    'EMAIL_1_RFQ_CREATED_ACCOUNT_AUTO_CREATED',
    'EMAIL_2_RFQ_CREATED',
    'EMAIL_3_NEW_RFQ_INTIMATION',
    'EMAIL_4_NEW_RFQ_TO_QUOTE',
    'EMAIL_5_QUOTATIONS_READY_TO_COMPARE',
    'EMAIL_6_ACTIVATE_YOUR_ACCOUNT',
    'EMAIL_7_RFQ_NEEDS_MORE_INFORMATION',
    'EMAIL_8_NO_QUOTES_YET',
    'EMAIL_9_QUOTE_DEADLINE_REMINDER',
    'EMAIL_10_LOW_OR_ZERO_CREDITS',
    'EMAIL_11_QUOTE_SUBMITTED',
    'EMAIL_12_RFQ_REVISED_BUYER_QUESTION',
    'EMAIL_13_COMPLETE_YOUR_PROFILE',
  ],
};

module.exports = {
  DOMAIN_TYPES,
};


