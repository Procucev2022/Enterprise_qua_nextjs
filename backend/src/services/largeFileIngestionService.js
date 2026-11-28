// ==============================================================================
// LARGE FILE STREAMING INGESTION SERVICE
// ==============================================================================
// Handles ingestion of large CSV files (tens of thousands of rows — see
// VENDOR_INGESTION_CONFIG.MAX_VENDOR_MASTER_ROWS/MAX_PO_ROWS for the real
// caps). Processes rows in configurable chunks, persists live progress to
// `ingestion_jobs` and `vendor_ingestion_sessions`, and continues in the
// background even if the buyer closes the modal or browser — on Workers,
// "background" means handed to ctx.waitUntil() (see the getWaitUntil() calls
// below), since an unawaited promise with nothing extending it can be
// cancelled the instant the response is sent.
//
// The raw upload used to be written to a local temp file (fs.createWriteStream)
// and streamed back off disk. Cloudflare Workers has no persistent local
// filesystem at all, so that produced a job that looked started but could
// never actually read its own file back — the upload now goes to R2 (the
// same store RFQ attachments already use on this deployment) instead, via
// r2Client/@aws-sdk/client-s3. It's read back as one buffered object rather
// than a live stream: bufferBody's for-await-of pattern is what's already
// proven to work against this SDK on Workers (see rfqAttachmentService.js),
// and the real row caps above make a single ~75MB-max buffer safe — nothing
// like the "1,000,000+ rows" this file's old top comment aspired to.
const { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const queries = require('../db/vendorIngestionQueries');
const buyerProfileQueries = require('../db/buyerProfileQueries');
const domainQueries = require('../db/domainQueries');
const pool = require('../db/pool');
const r2Client = require('./r2Client');
const r2NegativeCache = require('./r2NegativeCache');
const { getWaitUntil } = require('../db/d1Bridge');
const { logger } = require('./loggerService');
const { VALIDATION_SCHEMAS, validatePayload } = require('../config/validationSchemas');
const {
  VENDOR_INGESTION_SESSION_STATUS,
  VENDOR_INGESTION_STEP,
  VENDOR_INGESTION_AI_STATUS,
  VENDOR_INGESTION_JOB_TYPE,
  VENDOR_INGESTION_JOB_STATUS,
  VENDOR_INGESTION_CONFIG,
  VENDOR_INGESTION_MESSAGES,
  resolveVendorLocationFields,
} = require('../config/constants');

/** Same buffering pattern rfqAttachmentService.js already uses against this SDK. */
async function bufferBody(body) {
  const chunks = [];
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/** Store a raw upload in R2 ahead of background processing. Throws if R2 isn't configured. */
async function uploadToR2(key, buffer) {
  const binding = r2Client.getBinding();
  if (binding) {
    // Native R2 binding — see r2Client.js's getBinding() for why this is
    // preferred over the S3Client path below on Workers.
    await r2NegativeCache.putToBinding(binding, key, buffer, { httpMetadata: { contentType: 'text/csv' } });
    return;
  }
  const client = r2Client.getClient();
  if (!client) throw new Error('R2 storage is not configured — cannot accept a large file upload.');
  await client.send(
    new PutObjectCommand({ Bucket: r2Client.bucket(), Key: key, Body: buffer, ContentType: 'text/csv' })
  );
}

/** Read the whole uploaded CSV back, or null if it's gone (R2 unconfigured, already cleaned up, etc). */
async function downloadFromR2(key) {
  const binding = r2Client.getBinding();
  if (binding) {
    try {
      const object = await r2NegativeCache.getFromBinding(binding, key);
      if (!object) return null;
      return Buffer.from(await object.arrayBuffer());
    } catch (err) {
      logger.warn('Large-file R2 download failed', { key, error: err.message }, 'LARGE_FILE_INGESTION');
      return null;
    }
  }
  const client = r2Client.getClient();
  if (!client) return null;
  try {
    const response = await client.send(new GetObjectCommand({ Bucket: r2Client.bucket(), Key: key }));
    return bufferBody(response.Body);
  } catch (err) {
    logger.warn('Large-file R2 download failed', { key, error: err.message }, 'LARGE_FILE_INGESTION');
    return null;
  }
}

/** Best-effort cleanup — the object outliving one failed delete is not itself a correctness problem. */
async function deleteFromR2(key) {
  const binding = r2Client.getBinding();
  if (binding) {
    try {
      await r2NegativeCache.deleteFromBinding(binding, key);
    } catch (err) {
      logger.warn('Failed to clean up R2 ingestion upload', { key, error: err.message }, 'LARGE_FILE_INGESTION');
    }
    return;
  }
  const client = r2Client.getClient();
  if (!client) return;
  try {
    await client.send(new DeleteObjectCommand({ Bucket: r2Client.bucket(), Key: key }));
  } catch (err) {
    logger.warn('Failed to clean up R2 ingestion upload', { key, error: err.message }, 'LARGE_FILE_INGESTION');
  }
}

const LOG_CATEGORY = 'LARGE_FILE_INGESTION';
const DEFAULT_BATCH_SIZE = 500;
const activeCancellations = new Set();

/** Resolve organization ID from session user or session database record */
async function resolveOrganizationId(sessionUser, sessionId = null) {
  if (sessionUser) {
    if (sessionUser.organizationId) return sessionUser.organizationId;
    if (sessionUser.organization_id) return sessionUser.organization_id;
    if (sessionUser.orgId) return sessionUser.orgId;
    if (sessionUser.sub) {
      try {
        const lookup = await buyerProfileQueries.findProfileByUserId(sessionUser.sub);
        if (lookup && lookup.found && lookup.profile && lookup.profile.organizationId) {
          return lookup.profile.organizationId;
        }
      } catch (e) {
        logger.warn('Could not resolve ingestion organization from the subject identity; checking alternate identity claims', {
          error: e,
          lookupSource: 'subject',
          hasSessionId: Boolean(sessionId),
        }, LOG_CATEGORY);
      }
    }
    if (sessionUser.userId || sessionUser.id) {
      try {
        const lookup = await buyerProfileQueries.findProfileByUserId(sessionUser.userId || sessionUser.id);
        if (lookup && lookup.found && lookup.profile && lookup.profile.organizationId) {
          return lookup.profile.organizationId;
        }
      } catch (e) {
        logger.warn('Could not resolve ingestion organization from user identity claims; checking the session record', {
          error: e,
          lookupSource: 'user_id',
          hasSessionId: Boolean(sessionId),
        }, LOG_CATEGORY);
      }
    }
  }

  if (sessionId) {
    try {
      const sess = await queries.findSessionById(sessionId);
      if (sess && sess.organizationId) {
        return sess.organizationId;
      }
    } catch (e) {
      logger.error('Could not resolve ingestion organization from the session record', {
        error: e,
        lookupSource: 'session_id',
        hasSessionId: true,
      }, LOG_CATEGORY);
    }
  }

  return null;
}

/** Split a CSV line respecting quotes */
function parseCsvLine(line, delimiter = ',') {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"' || char === "'") {
      if (inQuotes && line[i + 1] === char) {
        current += char;
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

/** Fuzzy map header names to standard keys */
function extractHeaderIndices(headers, type) {
  const map = {};
  const cleaned = headers.map((h) => String(h || '').toLowerCase().replace(/[^a-z0-9]/g, ''));

  function findIndex(aliases) {
    for (const alias of aliases) {
      const aliasClean = alias.toLowerCase().replace(/[^a-z0-9]/g, '');
      const idx = cleaned.findIndex(
        (c) => c === aliasClean || (c.length > 0 && (c.includes(aliasClean) || (c.length >= 3 && aliasClean.includes(c))))
      );
      if (idx !== -1) return idx;
    }
    return -1;
  }

  if (type === 'VENDOR_MASTER') {
    map.vendorCode = findIndex(['vendorcode', 'vendor code', 'code', 'vendor id', 'supplier code', 'id']);
    map.companyName = findIndex(['companyname', 'company name', 'vendor name', 'supplier', 'name', 'vendor', 'supplier name']);
    map.contactPerson = findIndex(['contactperson', 'contact person', 'contact', 'person', 'representative', 'contact person name']);
    map.email = findIndex(['email', 'email id', 'email_id', 'mail', 'corporate email']);
    map.phone = findIndex(['phone', 'mobile', 'contact number', 'phone number', 'telephone', 'mobile number']);
    map.address = findIndex(['address', 'location', 'plant location', 'street', 'office address', 'city']);
    map.city = findIndex(['city', 'town', 'district']);
    map.state = findIndex(['state', 'province', 'region']);
    map.pincode = findIndex(['pincode', 'pin code', 'pin', 'zip', 'zipcode', 'zip code', 'postal code']);
    map.gstin = findIndex(['gstnumber', 'gstin', 'gst', 'gst number', 'tax id', 'gst no']);
    map.rating = findIndex(['vendorratingscore', 'rating', 'score', 'vendor rating', 'rating 0 100', 'performance score']);
  } else {
    // PO_DUMP
    map.poNumber = findIndex(['ponumber', 'po number', 'po #', 'po no', 'pono', 'order id', 'order number', 'order no']);
    map.poDate = findIndex(['podate', 'po date', 'date', 'order date', 'creation date']);
    map.vendorIdentifier = findIndex([
      'vendor name',
      'supplier name',
      'vendor/supplier name',
      'vendor name / code',
      'vendor identifier',
      'company name',
      'vendor code',
      'supplier code',
      'vendor id',
      'supplier id',
      'vendor',
      'supplier',
    ]);
    map.itemName = findIndex([
      'item description',
      'short text',
      'material description',
      'line item description',
      'item name & description',
      'item name',
      'product description',
      'product name',
      'service description',
      'line item',
      'description',
      'material',
      'service',
      'item',
    ]);
    map.specs = findIndex(['specs', 'specification', 'technical specs', 'specifications', 'details', 'item specs', 'grade']);
    map.quantity = findIndex(['quantity', 'qty', 'units', 'count', 'ordered qty', 'volume']);
    map.unit = findIndex(['unit', 'uom', 'unit of measure', 'units']);
    map.unitPrice = findIndex(['unit price inr', 'unit price', 'unit rate', 'rate inr', 'rate', 'price inr', 'price', 'item price']);
    map.spend = findIndex(['total spend inr', 'total spend (inr)', 'total spend rs', 'total spend', 'total amount inr', 'total amount (inr)', 'total amount', 'total inr', 'total (inr)', 'spend inr', 'spend', 'amount inr', 'amount', 'total value', 'po amount', 'total']);
    map.department = findIndex(['department', 'dept', 'cost center', 'plant', 'division', 'category', 'function']);
  }

  return map;
}

/**
 * Normalize a PO number to one consistent shape: trimmed, internal whitespace
 * collapsed, uppercased. Rows commonly spell the same PO as "po 4471",
 * "PO-4471" and "Po4471 " — without this they'd be treated as three
 * different purchase orders instead of deduping to one.
 */
function normalizePoNumber(raw) {
  const value = String(raw || '').trim().replace(/\s+/g, ' ');
  return value === '' ? '' : value.toUpperCase();
}

/**
 * Parse a PO date into a standard ISO (YYYY-MM-DD) string, trying the
 * formats actually seen in buyer PO exports: ISO itself, DD/MM/YYYY (and
 * DD-MM-YYYY), and whatever Date can parse natively (e.g. "15 Jun 2025").
 * Returns null rather than guessing when the value doesn't parse — a wrong
 * silent guess is worse than leaving the date blank for the buyer to fix.
 */
function normalizePoDate(raw) {
  const value = String(raw || '').trim();
  if (value === '') return null;

  // Numeric Excel date serial check (e.g. "45995.00011574074" or 45995)
  const num = Number(value);
  if (!isNaN(num) && isFinite(num) && !value.includes('-') && !value.includes('/') && !value.includes(':')) {
    if (num >= 1 && num <= 100000) {
      const utcDays = Math.floor(num - 25569);
      const d = new Date(utcDays * 86400 * 1000);
      if (!isNaN(d.getTime())) {
        const y = d.getUTCFullYear();
        const m = String(d.getUTCMonth() + 1).padStart(2, '0');
        const day = String(d.getUTCDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
      }
    }
  }

  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const dmy = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) {
    const day = dmy[1].padStart(2, '0');
    const month = dmy[2].padStart(2, '0');
    if (Number(month) <= 12) return `${dmy[3]}-${month}-${day}`;
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return null;
}

/** Lower-cased, trimmed email — so the same address in two different casings dedupes to one. */
function normalizeEmail(raw) {
  const value = String(raw || '').trim().toLowerCase();
  return value === '' ? '' : value;
}

/**
 * A single phone number in one standard shape: country code (+91) followed by
 * exactly 10 numeric digits without duplication, accepting numbers provided
 * with +91 or without it.
 */
function normalizePhone(raw) {
  if (raw === null || raw === undefined) return '';
  const trimmed = String(raw).trim();
  if (trimmed === '') return '';
  if (/[a-zA-Z]/.test(trimmed)) return null;

  let remainder = trimmed;
  // Repeatedly strip duplicate or multiple leading country code indicators
  while (/^\s*(?:\+\s*91|\(\s*\+?91\s*\)|\+\s*)/.test(remainder)) {
    remainder = remainder.replace(/^\s*(?:\+\s*91|\(\s*\+?91\s*\)|\+\s*)/, '').trim();
  }

  let digits = remainder.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) {
    digits = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith('0')) {
    digits = digits.slice(1);
  }

  if (digits.length === 10 && /^\d{10}$/.test(digits)) {
    return `+91${digits}`;
  }

  const allDigits = trimmed.replace(/\D/g, '');
  if (allDigits === '') return '';
  return trimmed.startsWith('+') ? `+${allDigits}` : allDigits;
}

/** Map row values array to object using header indices */
function mapRowValues(values, headerMap, type, rowIdx) {
  const get = (key) => {
    const idx = headerMap[key];
    if (idx !== undefined && idx !== -1 && values[idx] !== undefined) {
      return String(values[idx]).trim();
    }
    return '';
  };

  if (type === 'VENDOR_MASTER') {
    // Genuinely missing fields are left blank/null rather than filled with
    // invented placeholder data ("Supplier 7", "contact@supplier7.com") —
    // the buyer should see exactly what their file did and didn't supply,
    // not a fabricated row that looks real. Only companyName is required to
    // process the row at all (enforced in processVendorMasterBatch below).
    const companyName = get('companyName');
    const vendorCode = get('vendorCode') || null;
    const contactPerson = get('contactPerson') || null;
    const email = normalizeEmail(get('email')) || null;
    const phone = normalizePhone(get('phone')) || null;
    const explicitAddress = get('address');
    const explicitCity = get('city');
    const explicitState = get('state');
    const explicitPincode = get('pincode');
    const resolvedLoc = resolveVendorLocationFields({
      address: explicitAddress || explicitCity || explicitState || explicitPincode,
      city: explicitCity,
      state: explicitState,
      pincode: explicitPincode,
    });
    const address = resolvedLoc.location || null;
    const gstin = get('gstin') || null;
    const ratingRaw = get('rating');
    const rating = ratingRaw && !isNaN(Number(ratingRaw)) ? Math.min(100, Math.max(0, Math.round(Number(ratingRaw)))) : null;

    return {
      sourceRowNumber: rowIdx + 1,
      vendorCode,
      companyName,
      contactPerson,
      email,
      phone,
      address,
      city: resolvedLoc.city || null,
      state: resolvedLoc.state || null,
      pincode: resolvedLoc.pincode || null,
      gstNumber: gstin,
      rating,
    };
  } else {
    // PO_DUMP — only Vendor/Supplier Name (or Code) and Item Description/Short
    // Text/Material Description are mandatory; Specifications and all other
    // columns stay blank/null rather than invented when omitted.
    const poNumber = normalizePoNumber(get('poNumber')) || null;
    const poDate = normalizePoDate(get('poDate'));
    const vendorName = get('vendorIdentifier') || null;
    const itemDescription = get('itemName') || null;
    const specification = get('specs') || null;
    const qtyRaw = get('quantity');
    // A quantity the row does not give stays null. It is never set to 1, because a
    // made-up quantity would be stored as though the buyer had entered it.
    const parsedQuantity = qtyRaw ? Math.round(Number(String(qtyRaw).replace(/[^0-9.]/g, ''))) : 0;
    const quantity = parsedQuantity > 0 ? parsedQuantity : null;
    const uom = get('unit') || null;
    const unitPriceRaw = get('unitPrice');
    const spendRaw = get('spend');

    const parsedUnitPrice = unitPriceRaw && !isNaN(Number(String(unitPriceRaw).replace(/[^0-9.]/g, ''))) ? Number(String(unitPriceRaw).replace(/[^0-9.]/g, '')) : 0;
    const parsedSpend = spendRaw && !isNaN(Number(String(spendRaw).replace(/[^0-9.]/g, ''))) ? Number(String(spendRaw).replace(/[^0-9.]/g, '')) : 0;

    // Spend comes from the spend column, or from unit price times quantity when both are
    // given. Otherwise it stays null rather than being guessed as zero.
    const spend = parsedSpend > 0 ? parsedSpend : quantity !== null && parsedUnitPrice > 0 ? parsedUnitPrice * quantity : null;
    const department = get('department') || null;

    return {
      sourceRowNumber: rowIdx + 1,
      poNumber,
      poDate,
      vendorName,
      vendorCode: vendorName && vendorName.startsWith('VND-') ? vendorName : null,
      itemDescription,
      specification,
      quantity,
      uom,
      spend,
      currency: 'INR',
      department,
    };
  }
}

const PLACEHOLDER_GSTIN_VALUES = new Set(['', 'N/A', 'NA', 'NONE', 'NIL', '-', '—', 'NOTPROVIDED', 'NOTAPPLICABLE']);

function formatIngestionMessage(template, values = {}) {
  return Object.entries(values).reduce(
    (msg, [key, val]) => msg.replaceAll(`{${key}}`, String(val ?? '')),
    template
  );
}

function normalizeDedupeGstin(raw) {
  const cleaned = String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!cleaned || PLACEHOLDER_GSTIN_VALUES.has(cleaned)) return '';
  return cleaned.length >= 5 ? cleaned : '';
}

function normalizeDedupeCode(raw) {
  return String(raw || '').trim().toLowerCase();
}

function normalizeDedupeCompanyPhone(companyName, phone) {
  const normalizedCompany = String(companyName || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const digits = String(phone || '').replace(/\D/g, '');
  const normalizedPhone = digits.length >= 10 ? digits.slice(-10) : digits;
  if (!normalizedCompany || normalizedPhone.length < 7) return null;
  return `${normalizedCompany}|${normalizedPhone}`;
}

function normalizeDedupeEmail(raw) {
  const emailKey = normalizeEmail(raw);
  return emailKey && emailKey.includes('@') ? emailKey : '';
}

function createVendorDedupeState() {
  return {
    existingEmails: new Set(),
    existingGstins: new Set(),
    existingCodes: new Set(),
    existingNumericCodes: new Set(),
    existingCompanyPhones: new Set(),
    fileEmails: new Map(),
    fileGstins: new Map(),
    fileCodes: new Map(),
    fileCompanyPhones: new Map(),
    usedSequentialCodes: new Set(),
    nextSeq: 1,
  };
}

function seedExistingVendorsIntoDedupeState(state, existingVendors = []) {
  for (const existing of existingVendors) {
    if (!existing) continue;
    const emailKey = normalizeDedupeEmail(existing.email);
    if (emailKey) state.existingEmails.add(emailKey);

    const gstinKey = normalizeDedupeGstin(existing.gstNumber || existing.gstin);
    if (gstinKey) state.existingGstins.add(gstinKey);

    const codeKey = normalizeDedupeCode(existing.vendorCode);
    if (codeKey) {
      state.usedSequentialCodes.add(codeKey);
      if (!/^\d+$/.test(codeKey)) state.existingCodes.add(codeKey);
      else state.existingNumericCodes.add(codeKey);
    }

    const companyPhoneKey = normalizeDedupeCompanyPhone(existing.companyName || existing.name, existing.phone);
    if (companyPhoneKey) state.existingCompanyPhones.add(companyPhoneKey);
  }
}

async function loadExistingVendorDedupeState(session, organizationId) {
  const state = createVendorDedupeState();
  if (!pool.hasStorage() || !session) return state;
  try {
    const existingVendors = await domainQueries.getVendorsByBuyerFromDB(
      [session.createdByUserId, organizationId].filter(Boolean),
      500,
      session.createdByEmail || null
    );
    seedExistingVendorsIntoDedupeState(state, existingVendors);
    let existingMasterRecords =
      typeof queries.findOrganizationVendorMasterRecords === 'function'
        ? await queries.findOrganizationVendorMasterRecords(organizationId, 500)
        : [];
    if ((!Array.isArray(existingMasterRecords) || existingMasterRecords.length === 0) && session.id && typeof queries.findVendorMasterRecords === 'function') {
      existingMasterRecords = await queries.findVendorMasterRecords(session.id, organizationId, 500);
    }
    seedExistingVendorsIntoDedupeState(state, existingMasterRecords);
  } catch (err) {
    logger.warn(
      'Failed to pre-load existing buyer vendors for duplicate check; continuing with intra-file dedupe',
      { organizationId, error: err.message },
      LOG_CATEGORY
    );
  }
  return state;
}

function checkAndRegisterVendorDedupe(state, { rowNumber, companyName, email, phone, gstNumber, explicitVendorCode }) {
  const emailKey = normalizeDedupeEmail(email);
  const gstinKey = normalizeDedupeGstin(gstNumber);
  const codeKey = normalizeDedupeCode(explicitVendorCode);
  const companyPhoneKey = normalizeDedupeCompanyPhone(companyName, phone);

  if (emailKey) {
    if (state.existingEmails.has(emailKey)) {
      return {
        matchedAgainst: 'EXISTING_VENDOR',
        reason: formatIngestionMessage(VENDOR_INGESTION_MESSAGES.DUPLICATE_EMAIL_EXISTING, { value: email }),
      };
    }
    const firstRow = state.fileEmails.get(emailKey);
    if (firstRow !== undefined) {
      return {
        matchedAgainst: 'FILE',
        reason: formatIngestionMessage(VENDOR_INGESTION_MESSAGES.DUPLICATE_EMAIL_FILE, { value: email, firstRow }),
      };
    }
  }

  if (gstinKey) {
    if (state.existingGstins.has(gstinKey)) {
      return {
        matchedAgainst: 'EXISTING_VENDOR',
        reason: formatIngestionMessage(VENDOR_INGESTION_MESSAGES.DUPLICATE_GSTIN_EXISTING, { value: gstinKey }),
      };
    }
    const firstRow = state.fileGstins.get(gstinKey);
    if (firstRow !== undefined) {
      return {
        matchedAgainst: 'FILE',
        reason: formatIngestionMessage(VENDOR_INGESTION_MESSAGES.DUPLICATE_GSTIN_FILE, { value: gstinKey, firstRow }),
      };
    }
  }

  if (codeKey) {
    if (!/^\d+$/.test(codeKey) && state.existingCodes.has(codeKey)) {
      return {
        matchedAgainst: 'EXISTING_VENDOR',
        reason: formatIngestionMessage(VENDOR_INGESTION_MESSAGES.DUPLICATE_CODE_EXISTING, {
          value: String(explicitVendorCode).trim(),
        }),
      };
    }
    const firstRow = state.fileCodes.get(codeKey);
    if (firstRow !== undefined) {
      return {
        matchedAgainst: 'FILE',
        reason: formatIngestionMessage(VENDOR_INGESTION_MESSAGES.DUPLICATE_CODE_FILE, {
          value: String(explicitVendorCode).trim(),
          firstRow,
        }),
      };
    }
  }

  if (companyPhoneKey) {
    if (state.existingCompanyPhones.has(companyPhoneKey)) {
      return {
        matchedAgainst: 'EXISTING_VENDOR',
        reason: formatIngestionMessage(VENDOR_INGESTION_MESSAGES.DUPLICATE_COMPANY_PHONE_EXISTING, {
          company: companyName,
          phone,
        }),
      };
    }
    const firstRow = state.fileCompanyPhones.get(companyPhoneKey);
    if (firstRow !== undefined) {
      return {
        matchedAgainst: 'FILE',
        reason: formatIngestionMessage(VENDOR_INGESTION_MESSAGES.DUPLICATE_COMPANY_PHONE_FILE, {
          company: companyName,
          phone,
          firstRow,
        }),
      };
    }
  }

  if (emailKey) state.fileEmails.set(emailKey, rowNumber);
  if (gstinKey) state.fileGstins.set(gstinKey, rowNumber);
  if (codeKey) state.fileCodes.set(codeKey, rowNumber);
  if (companyPhoneKey) state.fileCompanyPhones.set(companyPhoneKey, rowNumber);
  return null;
}

/**
 * Process a batch of Vendor Master records into the database
 */
async function processVendorMasterBatch(sessionId, organizationId, batch, dedupeState = null) {
  const activeDedupeState = dedupeState || createVendorDedupeState();
  const valid = [];
  const invalid = [];
  const duplicateSkipped = [];

  // Track existing vendor codes to prevent collisions and generate sequential codes
  for (const row of batch) {
    if (row.vendorCode && String(row.vendorCode).trim()) {
      const cleanCode = String(row.vendorCode).trim().toLowerCase();
      if (!/^\d+$/.test(cleanCode) || !activeDedupeState.existingNumericCodes?.has(cleanCode)) {
        activeDedupeState.usedSequentialCodes.add(cleanCode);
      }
    }
  }

  const getNextSequentialCode = () => {
    while (activeDedupeState.usedSequentialCodes.has(String(activeDedupeState.nextSeq).toLowerCase())) {
      activeDedupeState.nextSeq++;
    }
    const code = String(activeDedupeState.nextSeq);
    activeDedupeState.usedSequentialCodes.add(code.toLowerCase());
    activeDedupeState.nextSeq++;
    return code;
  };

  for (let idx = 0; idx < batch.length; idx++) {
    const row = batch[idx];
    const companyName = row.companyName || row.company_name || row.vendorName || row.name || '';
    if (!companyName || String(companyName).trim() === '') {
      invalid.push({ row, reason: 'Company Name is required' });
      continue;
    }
    const rawPhone = row.phone !== undefined && row.phone !== null ? String(row.phone).trim() : '';
    let validatedPhone = null;
    if (rawPhone) {
      if (/[a-zA-Z]/.test(rawPhone)) {
        invalid.push({ row, reason: 'Mobile number cannot contain alphanumeric characters' });
        continue;
      }
      const norm = normalizePhone(rawPhone);
      if (!norm || !norm.startsWith('+91') || norm.slice(3).length !== 10) {
        invalid.push({ row, reason: 'Mobile number must be exactly 10 numeric digits after country code' });
        continue;
      }
      validatedPhone = norm;
    }

    const explicitVendorCode = row.vendorCode && String(row.vendorCode).trim()
      ? String(row.vendorCode).trim()
      : '';
    const trimmedCompany = String(companyName).trim();
    const resolvedEmail = row.email ? String(row.email).trim() : '';
    const resolvedGstin = row.gstNumber || row.gstin || '';
    const resolvedPhone = validatedPhone || (row.phone ? String(row.phone).trim() : null);
    const rowNumber = Number(row.sourceRowNumber) > 0 ? Number(row.sourceRowNumber) + 1 : idx + 2;

    const duplicateMatch = checkAndRegisterVendorDedupe(activeDedupeState, {
      rowNumber,
      companyName: trimmedCompany,
      email: resolvedEmail,
      phone: resolvedPhone,
      gstNumber: resolvedGstin,
      explicitVendorCode,
    });
    if (duplicateMatch) {
      duplicateSkipped.push({
        rowNumber,
        vendorCode: explicitVendorCode || undefined,
        companyName: trimmedCompany,
        email: resolvedEmail,
        phone: resolvedPhone || undefined,
        gstNumber: resolvedGstin || undefined,
        status: 'duplicate_skipped',
        matchedAgainst: duplicateMatch.matchedAgainst,
        reason: duplicateMatch.reason,
      });
      continue;
    }

    const isCollidingAutoNumericCode =
      Boolean(explicitVendorCode) &&
      /^\d+$/.test(explicitVendorCode) &&
      Boolean(activeDedupeState.existingNumericCodes?.has(explicitVendorCode.toLowerCase()));
    const vendorCode = (!explicitVendorCode || isCollidingAutoNumericCode)
      ? getNextSequentialCode()
      : explicitVendorCode;

    valid.push({
      ...row,
      vendorCode,
      companyName: trimmedCompany,
      phone: resolvedPhone,
      ...(resolvedGstin ? { gstin: resolvedGstin, gstNumber: resolvedGstin, gst: resolvedGstin } : {}),
    });
  }

  let imported = 0;
  let skipped = invalid.length + duplicateSkipped.length;

  if (valid.length > 0) {
    try {
      const stored = await queries.bulkUpsertVendorMasterRecords(sessionId, organizationId, valid);
      imported = Array.isArray(stored) ? stored.length : (typeof stored === 'number' ? stored : valid.length);
    } catch (err) {
      logger.error('Failed to upsert vendor master batch', err, LOG_CATEGORY);
      skipped += valid.length;
      invalid.push({ reason: `Database error: ${err.message}` });
    }
  }

  return {
    imported,
    skipped,
    failed: invalid.length,
    errors: [...duplicateSkipped, ...invalid].slice(0, 50),
  };
}

/**
 * Normalize text fields for PO line-item deduplication.
 */
function normalizePoDedupeText(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function normalizePoDedupeNumber(raw) {
  if (raw === null || raw === undefined || raw === '') return '';
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) return '';
  return String(Math.round(num * 100) / 100);
}

/**
 * Canonical fingerprint for a PO line item so re-uploaded PO files (3-column
 * template or full ERP PO dump) detect exact duplicates reliably without false
 * positives across distinct line items on the same PO.
 */
function buildPoLineDedupeKey(row) {
  if (!row || typeof row !== 'object') return '';
  const poNumberKey = normalizePoNumber(row.poNumber || row.po_number);
  const poDateKey = normalizePoDate(row.poDate || row.po_date || row.date) || '';
  const rawVendorName = normalizePoDedupeText(
    row.vendorName || row.vendorIdentifier || row.vendor_name || row.supplierName || row.supplier || row.companyName
  );
  const rawVendorCode = normalizePoDedupeText(row.vendorCode || row.vendor_code || row.supplierCode || row.vendorId);
  const vendorKey =
    rawVendorName && (!rawVendorCode || rawVendorName !== `vendor ${rawVendorCode}`)
      ? rawVendorName
      : rawVendorCode || rawVendorName;
  const itemKey = normalizePoDedupeText(
    row.itemDescription ||
      row.itemName ||
      row.item_description ||
      row.shortText ||
      row.short_text ||
      row.materialDescription ||
      row.material_description ||
      row.description
  );
  if (!vendorKey && !itemKey) return '';
  const specKey = normalizePoDedupeText(row.specification || row.specs);
  const qtyKey = normalizePoDedupeNumber(row.quantity);
  const spendKey = normalizePoDedupeNumber(row.spend ?? row.totalSpend);
  return [poNumberKey, poDateKey, vendorKey, itemKey, specKey, qtyKey, spendKey].join('|');
}

function formatPoDuplicateSummary({ poNumber, vendorName, vendorCode, itemDescription }) {
  const vendorLabel = String(vendorName || vendorCode || '').trim() || 'Unknown Vendor';
  const itemLabel = String(itemDescription || '').trim() || 'PO Line';
  const base = `${vendorLabel} — ${itemLabel}`;
  return poNumber ? `${poNumber} / ${base}` : base;
}

function createPoDedupeState() {
  return {
    existingKeys: new Set(),
    fileKeys: new Map(),
  };
}

function seedExistingPoRecordsIntoDedupeState(state, existingRecords = []) {
  for (const existing of existingRecords) {
    const key = buildPoLineDedupeKey(existing);
    if (key) state.existingKeys.add(key);
  }
}

async function loadExistingPoDedupeState(organizationId) {
  const state = createPoDedupeState();
  if (!organizationId || typeof queries.findExistingPoLineItemsByOrganization !== 'function') return state;
  try {
    const existing = await queries.findExistingPoLineItemsByOrganization(organizationId);
    seedExistingPoRecordsIntoDedupeState(state, Array.isArray(existing) ? existing : []);
  } catch (err) {
    logger.warn(
      'Failed to pre-load existing organization PO records for duplicate check; continuing with intra-file dedupe',
      { organizationId, error: err.message },
      LOG_CATEGORY
    );
  }
  return state;
}

function checkAndRegisterPoDedupe(state, row, rowNumber) {
  const key = buildPoLineDedupeKey(row);
  if (!key) return null;
  const summary = formatPoDuplicateSummary(row);
  if (state.existingKeys.has(key)) {
    return {
      matchedAgainst: 'EXISTING_PO',
      reason: formatIngestionMessage(VENDOR_INGESTION_MESSAGES.DUPLICATE_PO_EXISTING, { summary }),
    };
  }
  const firstRow = state.fileKeys.get(key);
  if (firstRow !== undefined) {
    return {
      matchedAgainst: 'FILE',
      reason: formatIngestionMessage(VENDOR_INGESTION_MESSAGES.DUPLICATE_PO_FILE, { summary, firstRow }),
    };
  }
  state.fileKeys.set(key, rowNumber);
  return null;
}

/**
 * Process a batch of PO Dump records into the database
 */
async function processPoDumpBatch(sessionId, organizationId, batch, session, dedupeState = null, options = null) {
  const activeDedupeState = dedupeState || createPoDedupeState();
  const valid = [];
  const invalid = [];
  const duplicateSkipped = [];

  // Required (only two): Vendor/Supplier Name (or Vendor Code) and
  // Item Description/Short Text/Material Description. Specifications and all
  // other PO columns are optional.
  for (let idx = 0; idx < batch.length; idx++) {
    const row = batch[idx];
    const vendorName = String(
      row.vendorName || row.vendorIdentifier || row.vendor_name || row.supplierName || row.supplier || row.companyName || ''
    ).trim();
    const vendorCode = String(row.vendorCode || row.vendor_code || row.supplierCode || row.vendorId || '').trim();
    const itemDescription = String(
      row.itemDescription ||
        row.itemName ||
        row.shortText ||
        row.short_text ||
        row.materialDescription ||
        row.material_description ||
        row.description ||
        ''
    ).trim();
    const specification = String(row.specification || row.specs || '').trim() || null;
    const department = row.department || row.category || '';

    if (!vendorName && !vendorCode) {
      invalid.push({ row, reason: 'Vendor Name or Vendor Code is required' });
      continue;
    }

    const poNumber = normalizePoNumber(row.poNumber || row.po_number) || null;
    const poDate = normalizePoDate(row.poDate || row.date);
    // Quantity and spend are never invented: a row that does not give them keeps them null.
    const quantity = Number(row.quantity) > 0 ? Number(row.quantity) : null;
    const spend = [row.spend, row.totalSpend].map(Number).find((value) => value > 0) ?? null;

    const candidate = {
      poNumber: poNumber || undefined,
      poDate,
      itemDescription,
      specification,
      quantity,
      uom: row.uom || row.unit,
      spend,
      department: department || null,
    };
    const { isValid, errors } = validatePayload(VALIDATION_SCHEMAS.poLineItemRow, candidate);
    if (!isValid) {
      invalid.push({ row, reason: Object.values(errors)[0] });
      continue;
    }

    const rowNumber = Number(row.sourceRowNumber) > 0 ? Number(row.sourceRowNumber) + 1 : idx + 2;
    const duplicateMatch = checkAndRegisterPoDedupe(
      activeDedupeState,
      { poNumber, poDate, vendorName, vendorCode, itemDescription, specification, quantity, spend },
      rowNumber
    );
    if (duplicateMatch) {
      duplicateSkipped.push({
        rowNumber,
        poNumber: poNumber || undefined,
        poDate: poDate || undefined,
        vendorName: vendorName || vendorCode,
        itemDescription,
        specification: specification || undefined,
        quantity: quantity ?? undefined,
        spend: spend ?? undefined,
        status: 'duplicate_skipped',
        matchedAgainst: duplicateMatch.matchedAgainst,
        reason: duplicateMatch.reason,
      });
      continue;
    }

    // Stamp inHorizon. With no horizon every row is inside. A row without a PO date is
    // kept inside as well, because a dump no longer has to carry dates to be used.
    const horizonConfigured = Boolean(session && session.horizonStart && session.horizonEnd);
    const inHorizon = !horizonConfigured || !poDate || (poDate >= session.horizonStart && poDate <= session.horizonEnd);

    valid.push({
      ...row,
      poNumber,
      poDate: poDate || null,
      vendorName: vendorName || `Vendor ${vendorCode}`,
      itemDescription,
      specification,
      department: department || null,
      quantity,
      spend,
      inHorizon,
    });
  }

  let imported = 0;
  let skipped = invalid.length + duplicateSkipped.length;

  if (valid.length > 0) {
    try {
      if (options && typeof options.beforeFirstInsert === 'function') {
        await options.beforeFirstInsert();
      }
      const stored = await queries.bulkInsertPoLineItems(sessionId, organizationId, valid);
      imported = typeof stored === 'number' ? stored : (Array.isArray(stored) ? stored.length : valid.length);
    } catch (err) {
      logger.error('Failed to insert PO dump batch', err, LOG_CATEGORY);
      skipped += valid.length;
      invalid.push({ reason: `Database error: ${err.message}` });
    }
  }

  return {
    imported,
    skipped,
    failed: invalid.length,
    errors: [...duplicateSkipped, ...invalid].slice(0, 50),
  };
}

/**
 * Stamp the organization's first vendor master upload once a VENDOR_MASTER job has stored rows.
 * A job that stored nothing does not count, so the buyer stays in setup until a usable file lands.
 */
async function recordVendorMasterUpload({ jobId, sessionId, organizationId, totalStored }) {
  if (totalStored <= 0) return;
  const firstUpload = await queries.markVendorMasterUploaded(organizationId);
  if (firstUpload) {
    logger.info(
      'Organization vendor master upload recorded for the first time',
      { jobId, sessionId, organizationId, totalStored },
      LOG_CATEGORY
    );
  }
}

/** Clear prior session rows & stale AI state when a replacement file begins ingesting. */
async function prepareSessionForReplacementUpload({ sessionId, organizationId, jobType }) {
  if (jobType === 'VENDOR_MASTER') {
    await queries.resetCategoryMappingsForReclassification(sessionId, organizationId);
    return;
  }
  await queries.deletePoLineItems(sessionId, organizationId);
  await queries.resetCategoryMappingsForReclassification(sessionId, organizationId);
}

/**
 * Derive reconciled progress counts and completion status so failed or empty
 * uploads are never reported as successful, and skipped duplicates do not
 * inflate stored/processing totals for Vendor Master or PO Dump uploads.
 */
function buildFinalUploadJobPatch({ jobType, rawTotal, imported, skipped, failed, recentErrors }) {
  const isUpload =
    jobType === VENDOR_INGESTION_JOB_TYPE.VENDOR_MASTER || jobType === VENDOR_INGESTION_JOB_TYPE.PO_DUMP;
  const duplicateCount = Math.max(0, skipped - failed);
  const effectiveTotal = isUpload ? Math.max(0, rawTotal - duplicateCount) : rawTotal;
  const processedRecords = isUpload ? imported + failed : imported + skipped + failed;
  const errors = Array.isArray(recentErrors) ? recentErrors : [];
  const firstFailure = errors.find((entry) => entry && entry.status !== 'duplicate_skipped');
  const firstReason = firstFailure?.reason || firstFailure?.message || '';

  let status = VENDOR_INGESTION_JOB_STATUS.COMPLETED;
  let errorMessage = null;

  if (rawTotal === 0) {
    status = VENDOR_INGESTION_JOB_STATUS.FAILED;
    errorMessage = formatIngestionMessage(VENDOR_INGESTION_MESSAGES.INGESTION_JOB_NO_RECORDS_PROCESSED, {
      total: 0,
    });
  } else if (
    (failed > 0 && imported === 0) ||
    (effectiveTotal > 0 && processedRecords === 0) ||
    (imported === 0 && skipped === 0)
  ) {
    status = VENDOR_INGESTION_JOB_STATUS.FAILED;
    errorMessage =
      firstReason ||
      formatIngestionMessage(VENDOR_INGESTION_MESSAGES.INGESTION_JOB_NO_RECORDS_PROCESSED, {
        total: rawTotal,
      });
  } else if (failed > 0 && imported > 0) {
    status = VENDOR_INGESTION_JOB_STATUS.PARTIAL_FAILURE;
    errorMessage = formatIngestionMessage(VENDOR_INGESTION_MESSAGES.INGESTION_JOB_PARTIAL_FAILED, {
      imported,
      failed,
    });
  }

  return {
    totalRecords: effectiveTotal,
    processedRecords,
    importedRecords: imported,
    skippedRecords: skipped,
    failedRecords: failed,
    status,
    ...(errorMessage ? { errorMessage } : {}),
    completedAt: new Date().toISOString(),
    errorDetails: errors.slice(-50),
  };
}

/**
 * Persist finalized session counts and advance the session step only when rows were actually stored.
 */
async function finalizeSessionAfterUpload({
  session,
  sessionId,
  organizationId,
  fileName,
  jobId,
  jobType,
  importedRecords = 0,
}) {
  if (jobType === 'VENDOR_MASTER') {
    const totalStored = await queries.countVendorMasterRecords(sessionId, organizationId);
    if (totalStored > 0) {
      await queries.updateSession(sessionId, organizationId, {
        vendorMasterFileName: fileName,
        vendorMasterRowCount: totalStored,
        status:
          session.status === VENDOR_INGESTION_SESSION_STATUS.DRAFT
            ? VENDOR_INGESTION_SESSION_STATUS.VENDOR_MASTER_STORED
            : session.status,
        currentStep: Math.max(session.currentStep, VENDOR_INGESTION_STEP.PO_DUMP),
      });
    }
    await recordVendorMasterUpload({ jobId, sessionId, organizationId, totalStored });
    return;
  }

  const counts = await queries.countPoLineItems(sessionId, organizationId);
  if (importedRecords <= 0 && counts.total > 0) {
    return;
  }
  await queries.updateSession(sessionId, organizationId, {
    poFileName: fileName,
    poRowCount: counts.total,
    poInHorizonCount: counts.inHorizon,
    poOutsideHorizonCount: counts.outsideHorizon,
    status: counts.total > 0 ? VENDOR_INGESTION_SESSION_STATUS.PO_STORED : session.status,
    currentStep:
      counts.total > 0
        ? Math.max(session.currentStep, VENDOR_INGESTION_STEP.AI_CATEGORY_JOIN)
        : session.currentStep,
    ...(counts.total > 0
      ? { aiStatus: VENDOR_INGESTION_AI_STATUS.IDLE, aiProcessedCount: 0, aiFailedCount: 0 }
      : {}),
  });
}

/**
 * Execute background streaming ingestion of a CSV or TXT file
 */
async function streamProcessCsvFile({ jobId, sessionId, organizationId, r2Key, fileName, jobType, batchSize = DEFAULT_BATCH_SIZE }) {
  try {
    const session = await queries.findSession(sessionId, organizationId);
    if (!session) {
      await queries.updateIngestionJobProgress(jobId, organizationId, {
        status: 'FAILED',
        errorMessage: 'Session not found',
        completedAt: new Date().toISOString(),
      });
      return;
    }

    let totalLines = 0;
    let processedRecords = 0;
    let importedRecords = 0;
    let skippedRecords = 0;
    let failedRecords = 0;
    const recentErrors = [];
    const vendorDedupeState = jobType === 'VENDOR_MASTER'
      ? await loadExistingVendorDedupeState(session, organizationId)
      : null;
    const poDedupeState = jobType === 'PO_DUMP'
      ? await loadExistingPoDedupeState(organizationId)
      : null;
    let poSessionPrepared = false;
    const ensurePoSessionPrepared = async () => {
      if (!poSessionPrepared) {
        poSessionPrepared = true;
        await prepareSessionForReplacementUpload({ sessionId, organizationId, jobType });
      }
    };

    try {
      // One R2 read for the whole upload — see this file's top comment for why
      // that's a safe amount to buffer (the real row caps top out ~75MB), and
      // why it's buffered rather than fed through as a live stream. The old
      // two-pass fs.createReadStream approach (open once just to count lines,
      // again to actually process) doesn't apply once the content already
      // sits in memory: the line count is immediate, and both "passes" below
      // read from the same buffered text instead of two separate disk/R2 reads.
      const buffer = await downloadFromR2(r2Key);
      if (!buffer) {
        await queries.updateIngestionJobProgress(jobId, organizationId, {
          status: 'FAILED',
          errorMessage: 'Uploaded file could not be read back from storage',
          completedAt: new Date().toISOString(),
        });
        return;
      }
      const text = buffer.toString('utf8');
      const allLines = text.split(/\r\n|\r|\n/);

      totalLines = Math.max(0, allLines.filter((line) => line.trim().length > 0).length - 1); // Exclude header line
      if (totalLines > 0 && jobType === 'VENDOR_MASTER') {
        await prepareSessionForReplacementUpload({ sessionId, organizationId, jobType });
      }

      await queries.updateIngestionJobProgress(jobId, organizationId, {
        totalRecords: totalLines,
        status: 'PROCESSING',
      });

      let isHeader = true;
      let headerMap = null;
      let currentBatch = [];
      let delimiter = ',';

      for (const line of allLines) {
        if (!line || line.trim().length === 0) continue;

        if (isHeader) {
          if (line.includes('\t')) delimiter = '\t';
          else if (line.includes(';') && !line.includes(',')) delimiter = ';';
          const headers = parseCsvLine(line, delimiter);
          headerMap = extractHeaderIndices(headers, jobType);
          isHeader = false;
          continue;
        }

        if (activeCancellations.has(jobId) || activeCancellations.has(sessionId)) {
          logger.info(`Ingestion job ${jobId} cancelled by user`, {}, LOG_CATEGORY);
          await queries.updateIngestionJobProgress(jobId, organizationId, {
            status: 'FAILED',
            errorMessage: 'Cancelled by user',
            completedAt: new Date().toISOString(),
          });
          return;
        }

        const values = parseCsvLine(line, delimiter);
        const record = mapRowValues(values, headerMap, jobType, processedRecords + currentBatch.length);
        currentBatch.push(record);

        if (currentBatch.length >= batchSize) {
          let result;
          if (jobType === 'VENDOR_MASTER') {
            result = await processVendorMasterBatch(sessionId, organizationId, currentBatch, vendorDedupeState);
          } else {
            result = await processPoDumpBatch(sessionId, organizationId, currentBatch, session, poDedupeState, {
              beforeFirstInsert: ensurePoSessionPrepared,
            });
          }

          processedRecords += currentBatch.length;
          importedRecords += result.imported;
          skippedRecords += result.skipped;
          failedRecords += result.failed;
          if (result.errors && result.errors.length > 0) {
            recentErrors.push(...result.errors);
          }

          currentBatch = [];

          // Update progress in database (excluding skipped duplicates from processed count)
          await queries.updateIngestionJobProgress(jobId, organizationId, {
            processedRecords: importedRecords + failedRecords,
            importedRecords,
            skippedRecords,
            failedRecords,
            errorDetails: recentErrors.slice(-50),
          });
        }
      }

      // Process remainder batch
      if (currentBatch.length > 0) {
        if (activeCancellations.has(jobId) || activeCancellations.has(sessionId)) {
          await queries.updateIngestionJobProgress(jobId, organizationId, {
            status: 'FAILED',
            errorMessage: 'Cancelled by user',
            completedAt: new Date().toISOString(),
          });
          return;
        }

        let result;
        if (jobType === 'VENDOR_MASTER') {
          result = await processVendorMasterBatch(sessionId, organizationId, currentBatch, vendorDedupeState);
        } else {
          result = await processPoDumpBatch(sessionId, organizationId, currentBatch, session, poDedupeState, {
            beforeFirstInsert: ensurePoSessionPrepared,
          });
        }

        processedRecords += currentBatch.length;
        importedRecords += result.imported;
        skippedRecords += result.skipped;
        failedRecords += result.failed;
        if (result.errors && result.errors.length > 0) {
          recentErrors.push(...result.errors);
        }
      }

      // Finalize session counts and state
      await finalizeSessionAfterUpload({
        session,
        sessionId,
        organizationId,
        fileName,
        jobId,
        jobType,
        importedRecords,
      });

      // Mark job with reconciled outcome (COMPLETED, PARTIAL_FAILURE, or FAILED)
      const finalPatch = buildFinalUploadJobPatch({
        jobType,
        rawTotal: Math.max(totalLines, processedRecords),
        imported: importedRecords,
        skipped: skippedRecords,
        failed: failedRecords,
        recentErrors,
      });
      await queries.updateIngestionJobProgress(jobId, organizationId, finalPatch);

      logger.info(`Ingestion job ${jobId} completed`, { processedRecords, importedRecords, skippedRecords, failedRecords }, LOG_CATEGORY);
    } catch (err) {
      logger.error(`Ingestion job ${jobId} failed`, err, LOG_CATEGORY);
      await queries.updateIngestionJobProgress(jobId, organizationId, {
        status: 'FAILED',
        errorMessage: err.message || 'Stream processing failure',
        completedAt: new Date().toISOString(),
      });
    }
  } finally {
    // Clean up the R2 upload unconditionally — deleteFromR2 is itself
    // best-effort (logs and swallows its own failure), so this never masks
    // whatever the try block above already reported.
    if (r2Key) {
      await deleteFromR2(r2Key);
    }
  }
}

/**
 * Process memory array or parsed chunks in background
 */
async function processArrayJob({ jobId, sessionId, organizationId, rows, fileName, jobType, batchSize = DEFAULT_BATCH_SIZE }) {
  try {
    const session = await queries.findSession(sessionId, organizationId);
    if (!session) {
      await queries.updateIngestionJobProgress(jobId, organizationId, {
        status: 'FAILED',
        errorMessage: 'Session not found',
        completedAt: new Date().toISOString(),
      });
      return;
    }

    let processedRecords = 0;
    let importedRecords = 0;
    let skippedRecords = 0;
    let failedRecords = 0;
    const recentErrors = [];
    if (rows.length > 0 && jobType === 'VENDOR_MASTER') {
      await prepareSessionForReplacementUpload({ sessionId, organizationId, jobType });
    }
    const vendorDedupeState = jobType === 'VENDOR_MASTER'
      ? await loadExistingVendorDedupeState(session, organizationId)
      : null;
    const poDedupeState = jobType === 'PO_DUMP'
      ? await loadExistingPoDedupeState(organizationId)
      : null;
    let poSessionPrepared = false;
    const ensurePoSessionPrepared = async () => {
      if (!poSessionPrepared) {
        poSessionPrepared = true;
        await prepareSessionForReplacementUpload({ sessionId, organizationId, jobType });
      }
    };
    for (let i = 0; i < rows.length; i += batchSize) {
      if (activeCancellations.has(jobId) || activeCancellations.has(sessionId)) {
        logger.info(`Array ingestion job ${jobId} cancelled by user`, {}, LOG_CATEGORY);
        await queries.updateIngestionJobProgress(jobId, organizationId, {
          status: 'FAILED',
          errorMessage: 'Cancelled by user',
          completedAt: new Date().toISOString(),
        });
        return;
      }

      const chunk = rows.slice(i, i + batchSize).map((r, offset) => ({
        ...r,
        sourceRowNumber: r && r.sourceRowNumber !== undefined ? r.sourceRowNumber : i + offset + 1,
      }));
      let result;
      if (jobType === 'VENDOR_MASTER') {
        result = await processVendorMasterBatch(sessionId, organizationId, chunk, vendorDedupeState);
      } else {
        result = await processPoDumpBatch(sessionId, organizationId, chunk, session, poDedupeState, {
          beforeFirstInsert: ensurePoSessionPrepared,
        });
      }

      processedRecords += chunk.length;
      importedRecords += result.imported;
      skippedRecords += result.skipped;
      failedRecords += result.failed;
      if (result.errors && result.errors.length > 0) {
        recentErrors.push(...result.errors);
      }

      await queries.updateIngestionJobProgress(jobId, organizationId, {
        processedRecords: importedRecords + failedRecords,
        importedRecords,
        skippedRecords,
        failedRecords,
        errorDetails: recentErrors.slice(-50),
      });
    }

    await finalizeSessionAfterUpload({
      session,
      sessionId,
      organizationId,
      fileName,
      jobId,
      jobType,
      importedRecords,
    });

    const finalPatch = buildFinalUploadJobPatch({
      jobType,
      rawTotal: Math.max(rows.length, processedRecords),
      imported: importedRecords,
      skipped: skippedRecords,
      failed: failedRecords,
      recentErrors,
    });
    await queries.updateIngestionJobProgress(jobId, organizationId, finalPatch);
  } catch (err) {
    logger.error(`Array Ingestion job ${jobId} failed`, err, LOG_CATEGORY);
    await queries.updateIngestionJobProgress(jobId, organizationId, {
      status: 'FAILED',
      errorMessage: err.message || 'Processing failure',
      completedAt: new Date().toISOString(),
    });
  }
}

/**
 * Start a background ingestion job for an uploaded file or array
 */
async function startIngestionJob({ sessionUser, sessionId, fileBuffer, rows, fileName, jobType, totalHint = 0 }) {
  const organizationId = await resolveOrganizationId(sessionUser, sessionId);
  if (!organizationId) {
    throw new Error('Organization not linked to user');
  }

  // Clear any past cancellation markers for this session
  activeCancellations.delete(sessionId);

  // Uploaded once, synchronously, before this returns — the background job
  // (kicked off further down) reads it back from R2 by this same key, so it
  // must already be durably stored by the time that job runs, not still
  // in flight. This one write is comparatively fast; it's the row-by-row
  // processing after it that's slow enough to need deferring.
  let r2Key = null;
  if (fileBuffer) {
    r2Key = `${VENDOR_INGESTION_CONFIG.UPLOAD_STORAGE_DIR}/${sessionId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.csv`;
    await uploadToR2(r2Key, fileBuffer);
  }

  const total = rows ? rows.length : totalHint;

  // Create job in database
  const job = await queries.createIngestionJob({
    sessionId,
    organizationId,
    jobType,
    fileName,
    totalRecords: total,
  });

  if (r2Key) {
    // Wrapped in a Promise constructed and handed to waitUntil synchronously,
    // right here — not inside the setImmediate callback. waitUntil only
    // needs a Promise reference to hold the invocation open for; it doesn't
    // need the underlying work to have started yet. Registering it any later
    // (e.g. from inside the callback, after setImmediate has already fired)
    // risks the response having gone out and the invocation already having
    // ended by then, which is the exact bug this whole waitUntil pattern
    // exists to avoid — see storeService.js's _background() for the fuller
    // rationale, and worker.mjs for where getWaitUntil() ultimately reads
    // Workers' waitUntil from.
    const backgroundJob = new Promise((resolve) => {
      setImmediate(() => {
        streamProcessCsvFile({
          jobId: job.id,
          sessionId,
          organizationId,
          r2Key,
          fileName,
          jobType,
        })
          .catch((err) => logger.error('Background ingestion job error', err, LOG_CATEGORY))
          .then(resolve);
      });
    });
    const waitUntil = getWaitUntil();
    if (waitUntil) waitUntil(backgroundJob);
    return job;
  } else if (Array.isArray(rows)) {
    if (rows.length <= 5000) {
      await processArrayJob({
        jobId: job.id,
        sessionId,
        organizationId,
        rows,
        fileName,
        jobType,
      });
      const updated = await queries.findIngestionJob(job.id, organizationId);
      return updated || {
        ...job,
        status: 'COMPLETED',
        totalRecords: rows.length,
        processedRecords: rows.length,
        importedRecords: rows.length,
        skippedRecords: 0,
        failedRecords: 0,
      };
    } else {
      // Same waitUntil registration pattern as the r2Key branch above.
      const backgroundJob = new Promise((resolve) => {
        setImmediate(() => {
          processArrayJob({
            jobId: job.id,
            sessionId,
            organizationId,
            rows,
            fileName,
            jobType,
          })
            .catch((err) => logger.error('Background array ingestion job error', err, LOG_CATEGORY))
            .then(resolve);
        });
      });
      const waitUntil = getWaitUntil();
      if (waitUntil) waitUntil(backgroundJob);
      return job;
    }
  }

  return job;
}

/**
 * Cancel an active background ingestion job
 */
async function cancelJob(sessionUser, sessionId, jobId = null, options = {}) {
  const organizationId = await resolveOrganizationId(sessionUser, sessionId);
  if (!organizationId) return false;

  activeCancellations.add(sessionId);
  if (jobId) activeCancellations.add(jobId);

  const activeJobs = await queries.findActiveIngestionJobs(sessionId, organizationId);
  for (const j of activeJobs) {
    if (!jobId || j.id === jobId) {
      activeCancellations.add(j.id);
      await queries.updateIngestionJobProgress(j.id, organizationId, {
        status: 'FAILED',
        errorMessage: 'Cancelled by user',
        completedAt: new Date().toISOString(),
      });
    }
  }

  if (options.discardVendorMaster || options.discardIncomplete) {
    if (typeof queries.deleteVendorMasterRecords === 'function') {
      await queries.deleteVendorMasterRecords(sessionId, organizationId).catch(() => 0);
    }
    if (typeof queries.deleteCategoryMappingsForSession === 'function') {
      await queries.deleteCategoryMappingsForSession(sessionId, organizationId).catch(() => 0);
    }
    if (typeof queries.updateSession === 'function') {
      await queries.updateSession(sessionId, organizationId, {
        status: VENDOR_INGESTION_SESSION_STATUS.DRAFT,
      }).catch(() => null);
    }
  }

  return true;
}

/**
 * Get the status of an ingestion job or active jobs for a session
 */
async function getJobStatus(sessionUser, sessionId, jobId = null, jobType = null) {
  const organizationId = await resolveOrganizationId(sessionUser, sessionId);
  if (!organizationId) return null;

  if (jobId) {
    const job = await queries.findIngestionJob(jobId, organizationId);
    if (job && (job.status === 'PROCESSING' || job.status === 'PENDING')) {
      const lastProgress = Date.parse(job.updatedAt || job.startedAt || '');
      if (Number.isFinite(lastProgress) && Date.now() - lastProgress > 60000) {
        await queries
          .updateIngestionJobProgress(job.id, organizationId, {
            status: 'FAILED',
            errorMessage:
              job.errorMessage ||
              'AI categorization stopped unexpectedly before every supplier was classified. Run the categorization again to resume.',
            completedAt: new Date().toISOString(),
          })
          .catch(() => {});
        return {
          ...job,
          status: 'FAILED',
          errorMessage:
            job.errorMessage ||
            'AI categorization stopped unexpectedly before every supplier was classified. Run the categorization again to resume.',
          completedAt: new Date().toISOString(),
        };
      }
    }
    return job;
  }

  const activeJobs = await queries.findActiveIngestionJobs(sessionId, organizationId);
  if (jobType) {
    const matching = activeJobs.find((j) => j.jobType === jobType);
    return matching || null;
  }

  if (activeJobs.length > 0) return activeJobs[0];

  return null;
}

module.exports = {
  resolveOrganizationId,
  startIngestionJob,
  cancelJob,
  getJobStatus,
  streamProcessCsvFile,
  processArrayJob,
  processVendorMasterBatch,
  processPoDumpBatch,
  parseCsvLine,
  extractHeaderIndices,
  mapRowValues,
  activeCancellations,
  deleteFromR2,
  normalizePoDate,
  buildPoLineDedupeKey,
  createPoDedupeState,
  seedExistingPoRecordsIntoDedupeState,
  loadExistingPoDedupeState,
  checkAndRegisterPoDedupe,
};
