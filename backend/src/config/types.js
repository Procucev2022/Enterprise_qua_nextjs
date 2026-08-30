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
 * @property {number} budget
 * @property {number} quotesCount
 * @property {string} status
 * @property {boolean} chasingActive
 * @property {Array<Object>} quotes
 * @property {Array<Object>} lineItems
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

const DOMAIN_TYPES = {
  RFQ_STATUSES: ['Ingested', 'Dispatched', 'In Evaluation', 'Quotes Pending', 'PO Awarded'],
  SOURCING_MODES: ['mode_1', 'mode_2', 'mode_3'],
  SEVERITY_LEVELS: ['INFO', 'WARN', 'ERROR', 'CRITICAL'],
  AUDIT_CATEGORIES: ['SECURITY', 'DATA_MUTATION', 'SYSTEM', 'AUTHENTICATION', 'PERFORMANCE'],
};

module.exports = {
  DOMAIN_TYPES,
};
