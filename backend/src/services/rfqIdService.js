// ==============================================================================
// RFQ ID ALLOCATION
// ==============================================================================
// Direct port of AutomaticRfqServiceImpl.generateRfqId in the Java p2pservices
// application, so an id minted here is indistinguishable from one minted there.
//
//   RFQ + yyddMM + 6 zero-padded digits        e.g. RFQ260409000512
//
// The date part really is year-day-month. That is what the Java
// SimpleDateFormat("yyddMM") pattern produces, and matching it byte-for-byte
// matters more than the ordering being conventional.
//
// Why this reserves through a table the Java app owns:
// both services allocate from the same 10^6 suffix space for the same day. If
// this workspace kept its own reservation list, the two could hand out the same
// id to different buyers, and `rfq_id` is unique — the second writer would fail
// at insert time, after the buyer had already been told the RFQ was created.
// A single shared reservation table is what makes the allocation atomic across
// both applications, which is why the INSERT is the final gate rather than a
// SELECT-then-INSERT check.
// ==============================================================================

const identityPoolModule = require('../db/identityPool');
const { RFQ_PERSISTENCE, RFQ_ID_CONFIG } = require('../config/constants');
const { logger } = require('./loggerService');

const {
  RFQ_TABLE,
  ID_RESERVATION_TABLE,
  LEGACY_RFQ_RECORDS_TABLE,
  LEGACY_RFQ_HEADER_TABLE,
} = RFQ_PERSISTENCE;

const { COMPANY, PREFIX_LENGTH, SUFFIX_MODULUS, SUFFIX_PAD, MAX_ATTEMPTS } = RFQ_ID_CONFIG;

// A reservation row already exists for this candidate: another allocator won the
// race. Not an error, just try the next suffix.
const DUPLICATE_ENTRY_CODE = 'ER_DUP_ENTRY';
// The legacy Java tables are absent in environments that only ever ran this
// workspace. Their absence means there is nothing to clash with.
const NO_SUCH_TABLE_CODE = 'ER_NO_SUCH_TABLE';

/**
 * Company prefix, matching the Java substring/uppercase behaviour including the
 * short-name case where the whole string is used.
 */
function buildPrefix(company = COMPANY) {
  const value = String(company || '');
  return value.length >= PREFIX_LENGTH
    ? value.slice(0, PREFIX_LENGTH).toUpperCase()
    : value.toUpperCase();
}

/**
 * The yyddMM date component. Exported so tests can pin a date rather than
 * asserting against whatever today happens to be.
 */
function buildDatePart(now = new Date()) {
  const yy = String(now.getFullYear() % 100).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  return `${yy}${dd}${mm}`;
}

/**
 * Assemble one candidate id from its parts.
 */
function buildCandidate(prefix, datePart, suffix) {
  return `${prefix}${datePart}${String(suffix).padStart(SUFFIX_PAD, '0')}`;
}

/**
 * Count rows in a table for a candidate id, treating a missing table as zero.
 */
async function countMatching(query, sql, candidate) {
  try {
    const rows = await query(sql, [candidate]);
    return Number(rows?.[0]?.total || 0);
  } catch (err) {
    if (err && err.code === NO_SUCH_TABLE_CODE) return 0;
    throw err;
  }
}

/**
 * Is this candidate free across this workspace's table and both legacy Java
 * tables? Checked before reserving so an obviously taken id does not leave a
 * stray reservation row behind.
 */
async function isCandidateFree(query, candidate) {
  const inWorkspace = await countMatching(
    query,
    `SELECT COUNT(*) AS total FROM \`${RFQ_TABLE}\` WHERE rfq_id = ?`,
    candidate
  );
  if (inWorkspace > 0) return false;

  const inLegacyRecords = await countMatching(
    query,
    `SELECT COUNT(*) AS total FROM \`${LEGACY_RFQ_RECORDS_TABLE}\` WHERE rfq_number = ?`,
    candidate
  );
  if (inLegacyRecords > 0) return false;

  const inLegacyHeader = await countMatching(
    query,
    `SELECT COUNT(*) AS total FROM \`${LEGACY_RFQ_HEADER_TABLE}\` WHERE rfq_id = ?`,
    candidate
  );
  return inLegacyHeader === 0;
}

/**
 * Claim the candidate by inserting it into the shared reservation table.
 * Returns false when another allocator already holds it.
 */
async function reserveCandidate(query, candidate) {
  try {
    await query(`INSERT INTO \`${ID_RESERVATION_TABLE}\` (rfq_number) VALUES (?)`, [candidate]);
    return true;
  } catch (err) {
    if (err && err.code === DUPLICATE_ENTRY_CODE) return false;
    throw err;
  }
}

/**
 * Allocate a unique RFQ id.
 *
 * @param {object} [options]
 * @param {Function} [options.query] parameterised query function, injected by tests
 * @param {Date}     [options.now]   fixed clock, injected by tests
 * @param {string}   [options.company] prefix source, defaults to 'RFQ'
 * @returns {Promise<string>} the reserved id
 */
async function generateRfqId(options = {}) {
  const query = options.query || identityPoolModule.identityQuery;
  const now = options.now || new Date();
  const prefix = buildPrefix(options.company);
  const datePart = buildDatePart(now);

  const start = now.getTime() % SUFFIX_MODULUS;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const suffix = (start + attempt) % SUFFIX_MODULUS;
    const candidate = buildCandidate(prefix, datePart, suffix);

    // eslint-disable-next-line no-await-in-loop -- allocation is inherently
    // sequential: each candidate must be resolved before the next is tried.
    if ((await isCandidateFree(query, candidate)) && (await reserveCandidate(query, candidate))) {
      if (attempt > 0) {
        logger.debug(
          `RFQ id allocated after ${attempt + 1} attempts.`,
          { candidate },
          'DATABASE'
        );
      }
      return candidate;
    }
  }

  throw new Error(
    `Unable to allocate a unique RFQ id after ${MAX_ATTEMPTS} attempts. ` +
      'The suffix space for today may be exhausted or the reservation table is unreachable.'
  );
}

module.exports = {
  buildPrefix,
  buildDatePart,
  buildCandidate,
  countMatching,
  isCandidateFree,
  reserveCandidate,
  generateRfqId,
};
