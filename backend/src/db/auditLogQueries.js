'use strict';

const pool = require('./pool');
const d1Bridge = require('./d1Bridge');
const { queryCache } = require('./queryCache');
const {
  AUDIT_CHAIN_WRITE_MAX_ATTEMPTS,
  AUDIT_CHAIN_VERIFY_PAGE_SIZE,
  AUDIT_CHAIN_VERIFY_MAX_ROWS,
  AUDIT_CHAIN_VERIFY_SNAPSHOT_ATTEMPTS,
} = require('../config/constants');
const { sealAuditEntry, verifyAuditTrail } = require('../services/auditService');
const { logger } = require('../services/loggerService');

function parseRaw(value) {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (cause) {
      const error = new Error('Persisted audit log data contains invalid JSON.');
      error.code = 'INVALID_PERSISTED_RECORD';
      error.cause = cause;
      throw error;
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function missingChainStateError() {
  const error = new Error('Audit chain state is missing. Apply the audit-chain-state migration before writing audit entries.');
  error.code = 'AUDIT_CHAIN_STATE_MISSING';
  error.statusCode = 503;
  return error;
}

function nonAtomicAdapterError() {
  const error = new Error('Audit-chain append requires an atomic D1 batch; the D1 HTTP adapter cannot guarantee it.');
  error.code = 'ATOMIC_D1_BATCH_REQUIRED';
  error.statusCode = 503;
  return error;
}

function invalidateAuditCache() {
  queryCache.invalidate('audit_logs');
}

async function findExistingD1Entry(entryId) {
  const result = await pool.query(
    'SELECT raw FROM audit_logs WHERE id = $1 LIMIT 1',
    [entryId],
    { d1: true, useCache: false }
  );
  return result.rows[0] ? parseRaw(result.rows[0].raw) : null;
}

async function readD1ChainState() {
  const result = await pool.query(
    'SELECT head_hash, root_hash, entry_count, revision FROM audit_chain_state WHERE id = 1 LIMIT 1',
    [],
    { d1: true, useCache: false }
  );
  return result.rows[0] || null;
}

async function appendAuditLogInD1(entry, binding) {
  for (let attempt = 1; attempt <= AUDIT_CHAIN_WRITE_MAX_ATTEMPTS; attempt += 1) {
    const existing = await findExistingD1Entry(entry.id);
    if (existing) return existing;

    const head = await readD1ChainState();
    if (!head) throw missingChainStateError();
    const sealedEntry = sealAuditEntry(entry, head.head_hash);
    const statements = [
      {
        text: `UPDATE audit_chain_state
          SET head_hash = $1,
              root_hash = CASE WHEN entry_count = 0 THEN $1 ELSE root_hash END,
              entry_count = entry_count + 1,
              revision = revision + 1
          WHERE id = 1 AND head_hash = $2 AND revision = $3
          RETURNING head_hash, root_hash, entry_count, revision`,
        params: [sealedEntry.shaSignature, head.head_hash, head.revision],
      },
      {
        text: `INSERT INTO audit_logs (id, raw)
          SELECT $1, $2 WHERE changes() = 1
          RETURNING raw`,
        params: [sealedEntry.id, JSON.stringify(sealedEntry)],
      },
    ];
    const results = await d1Bridge.batchD1(binding, statements);
    const stateUpdated = Boolean(results[0]?.rows?.[0]);
    const persisted = results[1]?.rows?.[0] ? parseRaw(results[1].rows[0].raw) : null;
    if (persisted) {
      invalidateAuditCache();
      return persisted;
    }
    if (stateUpdated) {
      throw new Error('Audit-chain head advanced without inserting its audit log entry.');
    }
  }

  const error = new Error('Audit-chain head changed repeatedly while appending an audit entry. Retry the operation.');
  error.code = 'AUDIT_CHAIN_CONTENTION';
  error.statusCode = 503;
  throw error;
}

async function appendAuditLogInPostgres(entry) {
  const persisted = await pool.withTransaction(async (client) => {
    const existingResult = await client.query('SELECT raw FROM audit_logs WHERE id = $1 LIMIT 1', [entry.id]);
    if (existingResult.rows[0]) return parseRaw(existingResult.rows[0].raw);

    const stateResult = await client.query(
      'SELECT head_hash, root_hash, entry_count, revision FROM audit_chain_state WHERE id = 1 FOR UPDATE'
    );
    const state = stateResult.rows[0];
    if (!state) throw missingChainStateError();

    // The first idempotency read can race another transaction that is waiting
    // on the same head row. Recheck after acquiring the lock so that a retry
    // with the same ID returns the committed row instead of hitting the PK.
    const concurrentExistingResult = await client.query(
      'SELECT raw FROM audit_logs WHERE id = $1 LIMIT 1',
      [entry.id]
    );
    if (concurrentExistingResult.rows[0]) return parseRaw(concurrentExistingResult.rows[0].raw);

    const sealedEntry = sealAuditEntry(entry, state.head_hash);
    const updatedState = await client.query(
      `UPDATE audit_chain_state
        SET head_hash = $1,
            root_hash = CASE WHEN entry_count = 0 THEN $1 ELSE root_hash END,
            entry_count = entry_count + 1,
            revision = revision + 1
        WHERE id = 1 AND head_hash = $2 AND revision = $3
        RETURNING head_hash, root_hash, entry_count, revision`,
      [sealedEntry.shaSignature, state.head_hash, state.revision]
    );
    if (!updatedState.rows[0]) {
      const error = new Error('Audit-chain head changed during a locked append.');
      error.code = 'AUDIT_CHAIN_CONTENTION';
      throw error;
    }

    const inserted = await client.query(
      'INSERT INTO audit_logs (id, raw) VALUES ($1, $2) RETURNING raw',
      [sealedEntry.id, JSON.stringify(sealedEntry)]
    );
    if (!inserted.rows[0]) throw new Error('Audit-chain append returned no persisted row.');
    return parseRaw(inserted.rows[0].raw);
  });
  invalidateAuditCache();
  return persisted;
}

async function readAuditChainStateInDB() {
  if (!pool.hasStorage()) return null;
  const result = await pool.query(
    'SELECT head_hash, root_hash, entry_count, revision FROM audit_chain_state WHERE id = 1 LIMIT 1',
    [],
    { d1: true, useCache: false }
  );
  return result.rows?.[0] || null;
}

async function readAuditLogPageInDB(beforeSequence = null) {
  const hasCursor = beforeSequence !== null && beforeSequence !== undefined;
  const pgSql = hasCursor
    ? 'SELECT sequence, raw FROM audit_logs WHERE sequence < $1 ORDER BY sequence DESC LIMIT $2'
    : 'SELECT sequence, raw FROM audit_logs ORDER BY sequence DESC LIMIT $1';
  const d1Sql = hasCursor
    ? 'SELECT rowid AS sequence, raw FROM audit_logs WHERE rowid < $1 ORDER BY rowid DESC LIMIT $2'
    : 'SELECT rowid AS sequence, raw FROM audit_logs ORDER BY rowid DESC LIMIT $1';
  const params = hasCursor ? [beforeSequence, AUDIT_CHAIN_VERIFY_PAGE_SIZE] : [AUDIT_CHAIN_VERIFY_PAGE_SIZE];
  const result = await pool.query(pgSql, params, {
    d1: true,
    d1Text: d1Sql,
    useCache: false,
  });
  return (result.rows || []).map((row) => ({
    sequence: row.sequence,
    entry: parseRaw(row.raw),
  }));
}

function sameChainSnapshot(first, second) {
  return Boolean(first && second) &&
    String(first.head_hash || '') === String(second.head_hash || '') &&
    String(first.root_hash || '') === String(second.root_hash || '') &&
    Number(first.entry_count) === Number(second.entry_count) &&
    Number(first.revision) === Number(second.revision);
}

function incompleteVerification(expectedCount) {
  return {
    valid: null,
    complete: false,
    source: 'persisted',
    expectedCount,
    verifiedCount: 0,
    compromisedEntries: [],
    reason: `Audit trail exceeds the bounded verification limit of ${AUDIT_CHAIN_VERIFY_MAX_ROWS} records.`,
  };
}

async function verifyAuditChainInDB() {
  if (!pool.hasStorage()) return null;
  for (let snapshotAttempt = 1; snapshotAttempt <= AUDIT_CHAIN_VERIFY_SNAPSHOT_ATTEMPTS; snapshotAttempt += 1) {
    const initialState = await readAuditChainStateInDB();
    if (!initialState) throw missingChainStateError();
    const expectedCount = Number(initialState.entry_count);
    if (!Number.isSafeInteger(expectedCount) || expectedCount < 0) {
      const error = new Error('Persisted audit-chain entry count is invalid.');
      error.code = 'INVALID_AUDIT_CHAIN_STATE';
      error.statusCode = 503;
      throw error;
    }
    if (expectedCount > AUDIT_CHAIN_VERIFY_MAX_ROWS) return incompleteVerification(expectedCount);

    const entries = [];
    let cursor = null;
    while (entries.length < AUDIT_CHAIN_VERIFY_MAX_ROWS) {
      const page = await readAuditLogPageInDB(cursor);
      entries.push(...page.map(({ entry }) => entry));
      if (page.length < AUDIT_CHAIN_VERIFY_PAGE_SIZE) break;
      cursor = page[page.length - 1].sequence;
    }

    const finalState = await readAuditChainStateInDB();
    if (!sameChainSnapshot(initialState, finalState)) continue;
    const report = verifyAuditTrail(entries, {
      expectedHeadHash: initialState.head_hash || '',
      expectedRootHash: initialState.root_hash || '',
      expectedEntryCount: expectedCount,
    });
    return {
      ...report,
      complete: true,
      source: 'persisted',
      expectedCount,
      chainRevision: Number(initialState.revision),
    };
  }

  const error = new Error('Audit-chain state changed during verification; retry after writes settle.');
  error.code = 'AUDIT_CHAIN_SNAPSHOT_UNSTABLE';
  error.statusCode = 503;
  throw error;
}

async function appendAuditLogInDB(entry) {
  if (!pool.hasStorage()) return null;
  const binding = d1Bridge.getD1Binding();
  const httpAdapter = binding ? null : d1Bridge.getD1HttpClient();

  try {
    if (httpAdapter) throw nonAtomicAdapterError();
    if (binding) return await appendAuditLogInD1(entry, binding);
    return await appendAuditLogInPostgres(entry);
  } catch (error) {
    logger.error('Durable audit-chain append failed', {
      error,
      entryId: entry.id,
      provider: binding ? 'cloudflare-d1' : httpAdapter ? 'cloudflare-d1-http' : 'postgres',
    }, 'AUDIT_CHAIN');
    throw error;
  }
}

module.exports = {
  appendAuditLogInDB,
  readAuditChainStateInDB,
  readAuditLogPageInDB,
  verifyAuditChainInDB,
  parseRaw,
  missingChainStateError,
  nonAtomicAdapterError,
};
