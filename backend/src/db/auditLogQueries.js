'use strict';

const pool = require('./pool');
const { sealAuditEntry, verifyAuditTrail } = require('../services/auditService');
const { logger } = require('../services/loggerService');

// In-memory audit log store (database tables audit_logs and audit_chain_state dropped per migration 0029)
const inMemoryAuditLogs = [];
let inMemoryChainHead = '';
let inMemoryRootHash = '';
let inMemoryRevision = 0;

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

async function appendAuditLogInDB(entry) {
  if (!pool.hasStorage()) return null;

  const existing = inMemoryAuditLogs.find((candidate) => candidate.id === entry.id);
  if (existing) return existing;

  const sealedEntry = sealAuditEntry(entry, inMemoryChainHead);
  if (inMemoryAuditLogs.length === 0) {
    inMemoryRootHash = sealedEntry.shaSignature;
  }
  inMemoryChainHead = sealedEntry.shaSignature;
  inMemoryRevision += 1;
  inMemoryAuditLogs.unshift(sealedEntry);

  logger.info('Audit log entry recorded in memory', {
    id: sealedEntry.id,
    action: sealedEntry.action,
    shaSignature: sealedEntry.shaSignature,
  });

  return sealedEntry;
}

async function readAuditChainStateInDB() {
  if (!pool.hasStorage()) return null;
  return {
    head_hash: inMemoryChainHead,
    root_hash: inMemoryRootHash,
    entry_count: inMemoryAuditLogs.length,
    revision: inMemoryRevision,
  };
}

async function readAuditLogPageInDB(beforeSequence = null) {
  if (!pool.hasStorage()) return [];
  const entriesWithSequence = inMemoryAuditLogs.map((entry, index) => ({
    sequence: inMemoryAuditLogs.length - index,
    entry,
  }));
  if (beforeSequence !== null && beforeSequence !== undefined) {
    return entriesWithSequence.filter((row) => row.sequence < beforeSequence);
  }
  return entriesWithSequence;
}

async function verifyAuditChainInDB() {
  if (!pool.hasStorage()) return null;
  const report = verifyAuditTrail(inMemoryAuditLogs, {
    expectedHeadHash: inMemoryChainHead,
    expectedRootHash: inMemoryRootHash,
    expectedEntryCount: inMemoryAuditLogs.length,
  });
  return {
    ...report,
    complete: true,
    source: 'in_memory',
    expectedCount: inMemoryAuditLogs.length,
    chainRevision: inMemoryRevision,
  };
}

function resetInMemoryAuditChainForTesting() {
  inMemoryAuditLogs.length = 0;
  inMemoryChainHead = '';
  inMemoryRootHash = '';
  inMemoryRevision = 0;
}

module.exports = {
  appendAuditLogInDB,
  readAuditChainStateInDB,
  readAuditLogPageInDB,
  verifyAuditChainInDB,
  parseRaw,
  missingChainStateError,
  nonAtomicAdapterError,
  resetInMemoryAuditChainForTesting,
};
