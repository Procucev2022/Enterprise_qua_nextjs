'use strict';

const pool = require('./pool');
const d1Bridge = require('./d1Bridge');
const { AUDIT_CHAIN_WRITE_MAX_ATTEMPTS } = require('../config/constants');
const { sealAuditEntry } = require('../services/auditService');
const { queryCache } = require('./queryCache');
const { logger } = require('../services/loggerService');

function parseRaw(value) {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (cause) {
      const error = new Error('Persisted purchase-order data contains invalid JSON.');
      error.code = 'INVALID_PERSISTED_RECORD';
      error.cause = cause;
      throw error;
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function makeStatements(rfqIdOrNumber, updates, auditEntry, auditState = { head_hash: '', revision: 0 }) {
  const effectiveUpdates = { ...updates, poShaSignature: auditEntry.shaSignature };
  return {
    postgres: {
      update: `UPDATE rfqs
        SET status = 'PO Generated', raw = raw || $2::jsonb, updated_at = now()
        WHERE (id = $1 OR rfq_number = $1)
          AND COALESCE(raw->>'poFinalised', 'false') <> 'true'
        RETURNING raw`,
      updateAuditHead: `UPDATE audit_chain_state
        SET head_hash = $1,
            root_hash = CASE WHEN entry_count = 0 THEN $1 ELSE root_hash END,
            entry_count = entry_count + 1,
            revision = revision + 1
        WHERE id = 1 AND head_hash = $2 AND revision = $3
        RETURNING head_hash, root_hash, entry_count, revision`,
      audit: `INSERT INTO audit_logs (id, raw) VALUES ($1, $2)
        RETURNING raw`,
      postgresUpdateParams: [rfqIdOrNumber, JSON.stringify(effectiveUpdates)],
      auditStateParams: [auditEntry.shaSignature, auditState.head_hash, auditState.revision],
      auditParams: [auditEntry.id, JSON.stringify(auditEntry)],
    },
    d1: {
      updateAuditHead: `UPDATE audit_chain_state
        SET head_hash = $1,
            root_hash = CASE WHEN entry_count = 0 THEN $1 ELSE root_hash END,
            entry_count = entry_count + 1,
            revision = revision + 1
        WHERE id = 1 AND head_hash = $2 AND revision = $3
          AND EXISTS (
            SELECT 1 FROM rfqs
            WHERE (id = $4 OR rfq_number = $4)
              AND COALESCE(json_extract(raw, '$.poFinalised'), 0) NOT IN (1, 'true')
          )
        RETURNING head_hash, root_hash, entry_count, revision`,
      update: `UPDATE rfqs
        SET status = 'PO Generated', raw = json_patch(raw, $2), updated_at = CURRENT_TIMESTAMP
        WHERE (id = $1 OR rfq_number = $1)
          AND COALESCE(json_extract(raw, '$.poFinalised'), 0) NOT IN (1, 'true')
        RETURNING raw`,
      audit: `INSERT INTO audit_logs (id, raw)
        SELECT $1, $2 WHERE changes() = 1
        RETURNING raw`,
      d1HeadParams: [auditEntry.shaSignature, auditState.head_hash, auditState.revision, rfqIdOrNumber],
      d1UpdateParams: [rfqIdOrNumber, JSON.stringify(effectiveUpdates)],
      d1AuditParams: [auditEntry.id, JSON.stringify(auditEntry)],
    },
  };
}

function invalidateCaches() {
  queryCache.invalidate('rfqs');
}

function logQueryDuration(query, startedAt) {
  pool.queryAuditor?.auditQuery(query, [], Date.now() - startedAt, false);
}

async function approvePurchaseOrderInDB({ rfqIdOrNumber, updates, auditEntry }) {
  if (!pool.hasStorage()) return null;

  const startedAt = Date.now();
  const binding = d1Bridge.getD1Binding();
  const httpAdapter = binding ? null : d1Bridge.getD1HttpClient();

  if (httpAdapter) {
    const error = new Error('Purchase-order approval requires an atomic D1 batch.');
    error.statusCode = 503;
    error.code = 'ATOMIC_D1_BATCH_REQUIRED';
    logger.error('Purchase-order approval rejected by the non-atomic D1 HTTP adapter', {
      error,
      rfqIdOrNumber,
    }, 'PURCHASE_ORDER');
    throw error;
  }

  const canonicalAudit = sealAuditEntry(auditEntry, '');
  const statements = makeStatements(rfqIdOrNumber, updates, canonicalAudit);

  if (binding) {
    try {
      const results = await d1Bridge.batchD1(binding, [
        { text: statements.d1.update, params: statements.d1.d1UpdateParams },
      ]);
      const savedRFQ = results[0]?.rows?.[0] ? parseRaw(results[0].rows[0].raw) : null;
      if (!savedRFQ) return null;
      invalidateCaches();
      return { rfq: savedRFQ, auditEntry: canonicalAudit };
    } catch (error) {
      logger.error('Atomic D1 purchase-order approval failed', {
        error,
        rfqIdOrNumber,
        operation: 'approve-purchase-order',
      }, 'PURCHASE_ORDER');
      throw error;
    } finally {
      logQueryDuration(statements.d1.update, startedAt);
    }
  }

  try {
    const result = await pool.withTransaction(async (client) => {
      const rfqResult = await client.query(
        statements.postgres.update,
        statements.postgres.postgresUpdateParams
      );
      if (!rfqResult.rows?.[0]) return null;
      return {
        rfq: parseRaw(rfqResult.rows[0].raw),
        auditEntry: canonicalAudit,
      };
    });
    if (result) invalidateCaches();
    return result;
  } catch (error) {
    logger.error('PostgreSQL purchase-order approval transaction failed', {
      error,
      rfqIdOrNumber,
      operation: 'approve-purchase-order',
    }, 'PURCHASE_ORDER');
    throw error;
  } finally {
    logQueryDuration(statements.postgres.update, startedAt);
  }
}

module.exports = { approvePurchaseOrderInDB, makeStatements, parseRaw };
