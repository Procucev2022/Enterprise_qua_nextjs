/**
 * RFQ Document Attachment Storage
 *
 * Supporting documents a buyer attaches to an RFQ, held on disk and served back
 * verbatim. Nothing here touches Gemini: attachments exist for the manual flow,
 * where the buyer keys the line items and the document is evidence rather than
 * something to be read.
 *
 * Content deliberately does not live on the RFQ record. A 10MB PDF is roughly
 * 13MB of base64, and /api/bootstrap returns every RFQ, so inlining attachments
 * would grow that response without bound. The RFQ carries only the metadata this
 * module returns, and the bytes are fetched on demand by id.
 *
 * Security posture:
 *   - identifiers are generated here, never taken from the client
 *   - an id is matched against ID_PATTERN before it is joined onto a path, so a
 *     traversal attempt cannot escape the storage directory
 *   - the MIME type must appear in an allow-list, so an executable or script
 *     cannot be stored by omission
 *   - the decoded size is checked against MAX_BYTES before anything is written
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { RFQ_ATTACHMENT_CONFIG } = require('../config/constants');
const { logger } = require('./loggerService');

/** Machine-readable outcomes the controller maps onto responses. */
const ATTACHMENT_STATUS = {
  SAVED: 'SAVED',
  NO_CONTENT: 'NO_CONTENT',
  TOO_LARGE: 'TOO_LARGE',
  UNSUPPORTED_TYPE: 'UNSUPPORTED_TYPE',
  WRITE_FAILED: 'WRITE_FAILED',
};

/** Absolute storage directory, resolved once from the backend package root. */
function storageDir() {
  return path.resolve(__dirname, '..', '..', RFQ_ATTACHMENT_CONFIG.STORAGE_DIR);
}

/**
 * Absolute path for one stored file, or null when the id is not one we issued.
 *
 * Returning null rather than a path is what stops `../../etc/passwd` and any
 * other traversal attempt: an id that fails the pattern never reaches path.join.
 */
function resolveStoredPath(id, extension) {
  if (typeof id !== 'string' || !RFQ_ATTACHMENT_CONFIG.ID_PATTERN.test(id)) return null;
  return path.join(storageDir(), `${id}${extension}`);
}

/** True when the buyer may attach a document of this type. */
function isAllowedType(mimeType) {
  return RFQ_ATTACHMENT_CONFIG.ALLOWED_MIME_TYPES.includes(mimeType);
}

/**
 * Decoded byte length of a base64 payload, without allocating the buffer.
 *
 * Checked before decoding so an oversized upload is refused rather than briefly
 * materialised in memory.
 */
function decodedByteLength(base64) {
  const clean = String(base64 || '').replace(/\s/g, '');
  if (clean === '') return 0;
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  return Math.floor((clean.length * 3) / 4) - padding;
}

/**
 * Strip any directory component a browser may have supplied.
 *
 * The stored path never uses this — the generated id does — but the name is
 * echoed back to the UI and into the RFQ, so it is reduced to a leaf first.
 */
function safeFileName(fileName) {
  const leaf = path.basename(String(fileName || '').trim());
  return leaf === '' || leaf === '.' || leaf === '..' ? 'attachment' : leaf;
}

/**
 * Persist one attachment.
 *
 * Never throws: every failure is reported as a status the caller can turn into a
 * response, so a rejected upload does not take down the request.
 *
 * @param {Object} input
 * @param {string} input.fileName
 * @param {string} input.mimeType
 * @param {string} input.content base64-encoded file body
 * @returns {{status: string, attachment: Object|null, error: string|null}}
 */
function saveAttachment({ fileName, mimeType, content } = {}) {
  const failure = (status, error = null) => ({ status, attachment: null, error });

  if (!content) return failure(ATTACHMENT_STATUS.NO_CONTENT);
  if (!isAllowedType(mimeType)) return failure(ATTACHMENT_STATUS.UNSUPPORTED_TYPE);

  const size = decodedByteLength(content);
  if (size === 0) return failure(ATTACHMENT_STATUS.NO_CONTENT);
  if (size > RFQ_ATTACHMENT_CONFIG.MAX_BYTES) return failure(ATTACHMENT_STATUS.TOO_LARGE);

  const id = crypto.randomUUID();
  const meta = {
    id,
    fileName: safeFileName(fileName),
    mimeType,
    size,
    uploadedAt: new Date().toISOString(),
  };

  try {
    fs.mkdirSync(storageDir(), { recursive: true });
    // The metadata sidecar means a download can report the original name and type
    // without trusting whatever the client sends at download time.
    fs.writeFileSync(resolveStoredPath(id, '.bin'), Buffer.from(content, 'base64'));
    fs.writeFileSync(resolveStoredPath(id, '.json'), JSON.stringify(meta), 'utf8');
  } catch (err) {
    logger.error('Failed to store RFQ attachment', err, 'RFQ_ATTACHMENT');
    return failure(ATTACHMENT_STATUS.WRITE_FAILED, err.message);
  }

  logger.info(
    `Stored RFQ attachment ${meta.fileName} (${size} bytes)`,
    { id, mimeType, size },
    'RFQ_ATTACHMENT'
  );
  return { status: ATTACHMENT_STATUS.SAVED, attachment: meta, error: null };
}

/**
 * Read one attachment back.
 *
 * @returns {{meta: Object, content: Buffer}|null} null when the id is unknown,
 *   malformed, or its files are missing.
 */
function loadAttachment(id) {
  const binPath = resolveStoredPath(id, '.bin');
  const metaPath = resolveStoredPath(id, '.json');
  if (!binPath || !metaPath) return null;

  try {
    if (!fs.existsSync(binPath) || !fs.existsSync(metaPath)) return null;
    return {
      meta: JSON.parse(fs.readFileSync(metaPath, 'utf8')),
      content: fs.readFileSync(binPath),
    };
  } catch (err) {
    logger.error(`Failed to read RFQ attachment ${id}`, err, 'RFQ_ATTACHMENT');
    return null;
  }
}

module.exports = {
  ATTACHMENT_STATUS,
  storageDir,
  resolveStoredPath,
  isAllowedType,
  decodedByteLength,
  safeFileName,
  saveAttachment,
  loadAttachment,
};
