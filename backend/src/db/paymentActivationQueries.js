const pool = require('./pool');
const d1Bridge = require('./d1Bridge');
const { queryCache } = require('./queryCache');
const { logger } = require('../services/loggerService');
const { BUYER_FREE_TRIAL_RFQ_CREDITS } = require('../config/constants');

function parseRaw(value) {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (cause) {
      const error = new Error('Persisted payment record contains invalid JSON.');
      error.code = 'INVALID_PERSISTED_RECORD';
      error.cause = cause;
      throw error;
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function payerConfig(link) {
  const payerType = link.payerType === 'buyer' ? 'buyer' : 'vendor';
  if (payerType === 'buyer') {
    return { table: 'buyer_accounts', id: link.buyerAccountId || null, cacheTag: 'buyer_accounts', payerType };
  }
  return { table: 'vendors', id: link.vendorId || null, cacheTag: 'vendors', payerType };
}

function activationError(message, code = 'PAYMENT_ACTIVATION_CONFLICT') {
  const error = new Error(message);
  error.statusCode = 409;
  error.code = code;
  return error;
}

function updatedPayer(payer, link) {
  return {
    ...payer,
    subscriptionPlan: link.planId,
    ...(link.payerType === 'buyer' && link.billingDuration ? { billingDuration: link.billingDuration } : {}),
    ...(link.payerType === 'buyer' && link.planId === 'free_trial' ? { remainingFreeRFQs: BUYER_FREE_TRIAL_RFQ_CREDITS } : {}),
    ...(link.payerType !== 'buyer' ? { rfqDownloadsUsed: 0 } : {}),
  };
}

function updatedLink(link, rawResponse, activated) {
  return {
    ...link,
    status: 'PAID',
    rawResponse: rawResponse || link.rawResponse || null,
    activated,
    updatedAt: new Date().toISOString(),
  };
}

async function activateInPostgres(paymentLinkId, rawResponse) {
  return pool.withTransaction(async (client) => {
    const linkResult = await client.query('SELECT raw FROM payment_links WHERE id = $1 FOR UPDATE', [paymentLinkId]);
    if (!linkResult.rows?.[0]) return null;
    const link = parseRaw(linkResult.rows[0].raw);
    const payer = payerConfig(link);
    if (!payer.id || !link.planId) throw activationError('The paid link is missing its payer or subscription plan.');

    const payerResult = await client.query(`SELECT raw FROM ${payer.table} WHERE id = $1 FOR UPDATE`, [payer.id]);
    if (!payerResult.rows?.[0]) throw activationError('The paid subscription owner no longer exists.', 'PAYMENT_OWNER_NOT_FOUND');
    const existingPayer = parseRaw(payerResult.rows[0].raw);
    if (link.activated) {
      return { link, payer: existingPayer, payerType: payer.payerType, activated: false, replayed: true };
    }

    const savedPayer = updatedPayer(existingPayer, link);
    const savedLink = updatedLink(link, rawResponse, true);
    const payerWrite = await client.query(
      `UPDATE ${payer.table} SET raw = $2, updated_at = now() WHERE id = $1 RETURNING raw`,
      [payer.id, JSON.stringify(savedPayer)]
    );
    const linkWrite = await client.query(
      'UPDATE payment_links SET status = $2, raw = $3, updated_at = now() WHERE id = $1 RETURNING raw',
      [paymentLinkId, savedLink.status, JSON.stringify(savedLink)]
    );
    if (!payerWrite.rows?.[0] || !linkWrite.rows?.[0]) throw new Error('Payment activation transaction did not persist both rows.');
    return {
      link: parseRaw(linkWrite.rows[0].raw),
      payer: parseRaw(payerWrite.rows[0].raw),
      payerType: payer.payerType,
      activated: true,
      replayed: false,
    };
  });
}

function buyerUpdateStatement(link, payer) {
  const assignments = ["'$.subscriptionPlan'", '$4'];
  const params = [link.id, payer.id, 'buyer', link.planId];
  if (link.billingDuration) {
    assignments.push("'$.billingDuration'", '$5');
    params.push(link.billingDuration);
  }
  if (link.planId === 'free_trial') {
    assignments.push("'$.remainingFreeRFQs'", `$${params.length + 1}`);
    params.push(BUYER_FREE_TRIAL_RFQ_CREDITS);
  }
  const jsonSet = `json_set(raw, ${assignments.join(', ')})`;
  return {
    text: `UPDATE buyer_accounts
      SET raw = ${jsonSet}, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2 AND EXISTS (
        SELECT 1 FROM payment_links
        WHERE id = $1 AND buyer_account_id = $2 AND payer_type = $3
          AND COALESCE(json_extract(raw, '$.activated'), 0) <> 1
      )
      RETURNING raw`,
    params,
  };
}

function vendorUpdateStatement(link, payer) {
  return {
    text: `UPDATE vendors
      SET raw = json_set(raw, '$.subscriptionPlan', $4, '$.rfqDownloadsUsed', 0),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $2 AND EXISTS (
        SELECT 1 FROM payment_links
        WHERE id = $1 AND vendor_id = $2 AND payer_type = $3
          AND COALESCE(json_extract(raw, '$.activated'), 0) <> 1
      )
      RETURNING raw`,
    params: [link.id, payer.id, 'vendor', link.planId],
  };
}

function paymentLinkUpdateStatement(link, payer, rawResponse) {
  return {
    text: `UPDATE payment_links
      SET status = 'PAID',
          raw = json_set(raw, '$.status', 'PAID', '$.rawResponse', json($4),
            '$.activated', json('true'), '$.updatedAt', $5),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND ${payer.payerType === 'buyer' ? 'payer_type = $3 AND buyer_account_id = $2' : 'payer_type = $3 AND vendor_id = $2'}
        AND COALESCE(json_extract(raw, '$.activated'), 0) <> 1
        AND EXISTS (SELECT 1 FROM ${payer.table} WHERE id = $2)
      RETURNING raw`,
    params: [link.id, payer.id, payer.payerType, JSON.stringify(rawResponse || link.rawResponse || null), new Date().toISOString()],
  };
}

async function activateInD1(paymentLinkId, rawResponse, binding) {
  const linkSql = 'SELECT raw FROM payment_links WHERE id = $1 LIMIT 1';
  const linkResult = await pool.query(linkSql, [paymentLinkId], {
    d1: true,
    d1Text: linkSql,
    useCache: false,
  });
  if (!linkResult.rows?.[0]) return null;
  const link = parseRaw(linkResult.rows[0].raw);
  const payer = payerConfig(link);
  if (!payer.id || !link.planId) throw activationError('The paid link is missing its payer or subscription plan.');

  const payerUpdate = link.payerType === 'buyer' ? buyerUpdateStatement(link, payer) : vendorUpdateStatement(link, payer);
  const batch = [
    payerUpdate,
    paymentLinkUpdateStatement(link, payer, rawResponse),
    { text: 'SELECT raw FROM payment_links WHERE id = $1 LIMIT 1', params: [paymentLinkId] },
    { text: `SELECT raw FROM ${payer.table} WHERE id = $1 LIMIT 1`, params: [payer.id] },
  ];
  const startedAt = Date.now();
  const results = await d1Bridge.batchD1(binding, batch);
  const durationMs = Date.now() - startedAt;
  pool.queryAuditor.auditQuery(batch.map((statement) => statement.text).join('; '), [], durationMs, false);
  const finalLink = results[2]?.rows?.[0] ? parseRaw(results[2].rows[0].raw) : null;
  const finalPayer = results[3]?.rows?.[0] ? parseRaw(results[3].rows[0].raw) : null;
  if (!finalLink) return null;
  return {
    link: finalLink,
    payer: finalPayer,
    payerType: payer.payerType,
    activated: Boolean(results[1]?.rowCount),
    replayed: Boolean(finalLink.activated && !results[1]?.rowCount),
  };
}

async function activatePaymentLinkSubscriptionInDB({ paymentLinkId, rawResponse }) {
  if (!pool.hasStorage()) return null;
  const binding = d1Bridge.getD1Binding();
  const httpAdapter = binding ? null : d1Bridge.getD1HttpClient();
  if (httpAdapter) {
    const error = new Error('Payment activation requires an atomic D1 batch; the HTTP adapter cannot guarantee it.');
    error.statusCode = 503;
    error.code = 'ATOMIC_D1_BATCH_REQUIRED';
    logger.error('Payment activation rejected by the non-atomic D1 HTTP adapter', { error, paymentLinkId }, 'PAYMENT_ACTIVATION');
    throw error;
  }
  if (binding) {
    const result = await activateInD1(paymentLinkId, rawResponse, binding);
    if (result) {
      queryCache.invalidate('payment_links');
      queryCache.invalidate(result.payerType === 'buyer' ? 'buyer_accounts' : 'vendors');
    }
    logger.info('Atomic D1 payment activation completed', {
      paymentLinkId,
      payerType: result?.payerType,
      activated: result?.activated,
      replayed: result?.replayed,
    }, 'PAYMENT_ACTIVATION');
    return result;
  }

  const result = await activateInPostgres(paymentLinkId, rawResponse);
  if (result) {
    queryCache.invalidate('payment_links');
    queryCache.invalidate(result.payerType === 'buyer' ? 'buyer_accounts' : 'vendors');
  }
  logger.info('Atomic PostgreSQL payment activation completed', {
    paymentLinkId,
    payerType: result?.payerType,
    activated: result?.activated,
    replayed: result?.replayed,
  }, 'PAYMENT_ACTIVATION');
  return result;
}

async function updatePaymentLinkStatusInDB(paymentLinkId, updates) {
  if (!pool.hasStorage() || !paymentLinkId || !updates || !updates.status) return null;

  const updatedAt = new Date().toISOString();
  const rawResponse = JSON.stringify(updates.rawResponse === undefined ? null : updates.rawResponse);
  const params = [paymentLinkId, updates.status, rawResponse, updatedAt];
  const sql = `UPDATE payment_links
    SET status = $2,
        raw = jsonb_set(
          jsonb_set(
            jsonb_set(raw, '{status}', to_jsonb($2::text), true),
            '{rawResponse}', $3::jsonb, true
          ),
          '{updatedAt}', to_jsonb($4::text), true
        ),
        updated_at = now()
    WHERE id = $1
      AND (COALESCE(raw->>'activated', 'false') <> 'true' OR lower($2) = 'paid')
    RETURNING raw`;
  const d1Text = `UPDATE payment_links
    SET status = $2,
        raw = json_set(raw, '$.status', $2, '$.rawResponse', json($3), '$.updatedAt', $4),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
      AND (COALESCE(json_extract(raw, '$.activated'), 0) <> 1 OR LOWER($2) = 'paid')
    RETURNING raw`;

  const result = await pool.query(sql, params, {
    d1: true,
    d1Text,
    useCache: false,
    tag: 'payment_links',
  });
  queryCache.invalidate('payment_links');
  return result.rows?.[0] ? parseRaw(result.rows[0].raw) : null;
}

module.exports = {
  activatePaymentLinkSubscriptionInDB,
  updatePaymentLinkStatusInDB,
  parseRaw,
  payerConfig,
  updatedPayer,
  updatedLink,
  buyerUpdateStatement,
  vendorUpdateStatement,
  paymentLinkUpdateStatement,
  activateInPostgres,
  activateInD1,
};
