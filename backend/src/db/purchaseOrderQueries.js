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
          AND changes() = 1
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
  queryCache.invalidate('audit_logs');
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

  if (binding) {
    const allQueries = [];
    try {
      for (let attempt = 1; attempt <= AUDIT_CHAIN_WRITE_MAX_ATTEMPTS; attempt += 1) {
        const headResult = await pool.query(
          'SELECT head_hash, root_hash, entry_count, revision FROM audit_chain_state WHERE id = 1 LIMIT 1',
          [],
          { d1: true, useCache: false }
        );
        const auditState = headResult.rows[0];
        if (!auditState) {
          const error = new Error('Audit-chain state is missing. Apply the audit-chain-state migration.');
          error.code = 'AUDIT_CHAIN_STATE_MISSING';
          error.statusCode = 503;
          throw error;
        }
        const canonicalAudit = sealAuditEntry(auditEntry, auditState.head_hash);
        const statements = makeStatements(
          rfqIdOrNumber,
          updates,
          canonicalAudit,
          auditState
        );
        const batch = [
          { text: statements.d1.updateAuditHead, params: statements.d1.d1HeadParams },
          { text: statements.d1.update, params: statements.d1.d1UpdateParams },
          { text: statements.d1.audit, params: statements.d1.d1AuditParams },
        ];
        allQueries.push(...batch.map((statement) => statement.text));
        const results = await d1Bridge.batchD1(binding, batch);
        if (!results[0]?.rows?.[0]) continue;
        const savedRFQ = results[1]?.rows?.[0] ? parseRaw(results[1].rows[0].raw) : null;
        const savedAudit = results[2]?.rows?.[0] ? parseRaw(results[2].rows[0].raw) : null;
        if (!savedRFQ || !savedAudit) {
          throw new Error('Atomic purchase-order batch advanced the audit head without saving both records.');
        }
        invalidateCaches();
        return { rfq: savedRFQ, auditEntry: savedAudit };
      }
      return null;
    } catch (error) {
      logger.error('Atomic D1 purchase-order approval failed', {
        error,
        rfqIdOrNumber,
        operation: 'approve-purchase-order',
      }, 'PURCHASE_ORDER');
      throw error;
    } finally {
      logQueryDuration(allQueries.join('; '), startedAt);
    }
  }

  try {
    const result = await pool.withTransaction(async (client) => {
      const stateResult = await client.query(
        'SELECT head_hash, root_hash, entry_count, revision FROM audit_chain_state WHERE id = 1 FOR UPDATE'
      );
      const auditState = stateResult.rows[0];
      if (!auditState) {
        const error = new Error('Audit-chain state is missing. Apply the audit-chain-state migration.');
        error.code = 'AUDIT_CHAIN_STATE_MISSING';
        error.statusCode = 503;
        throw error;
      }
      const canonicalAudit = sealAuditEntry(auditEntry, auditState.head_hash);
      const statements = makeStatements(rfqIdOrNumber, updates, canonicalAudit, auditState);
      const rfqResult = await client.query(
        statements.postgres.update,
        statements.postgres.postgresUpdateParams
      );
      if (!rfqResult.rows?.[0]) return null;
      const headResult = await client.query(
        statements.postgres.updateAuditHead,
        statements.postgres.auditStateParams
      );
      if (!headResult.rows[0]) throw new Error('Audit-chain head changed during purchase-order approval.');
      const auditResult = await client.query(
        statements.postgres.audit,
        statements.postgres.auditParams
      );
      if (!auditResult.rows?.[0]) throw new Error('Purchase-order approval transaction did not persist its audit record.');
      return {
        rfq: parseRaw(rfqResult.rows[0].raw),
        auditEntry: parseRaw(auditResult.rows[0].raw),
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
    logQueryDuration('purchase-order RFQ update; audit-chain head update; audit-log insert', startedAt);
  }
}

module.exports = { approvePurchaseOrderInDB, makeStatements, parseRaw };
