const pool = require('./pool');
const { ZOHO_CONFIG } = require('../config/constants');

const DB_OPTIONS = Object.freeze({ d1: true, tag: 'zoho_reconciliation_claims', useCache: false });

function normalizePaymentLinkId(paymentLinkId) {
  return paymentLinkId === undefined || paymentLinkId === null ? '' : String(paymentLinkId).trim();
}

async function claimPaymentLinkReconciliation(paymentLinkId, now = new Date()) {
  const normalizedId = normalizePaymentLinkId(paymentLinkId);
  if (!normalizedId) return { claimed: false, reason: 'MISSING_PAYMENT_LINK_ID' };

  const nowIso = now.toISOString();
  const leaseExpiresAt = new Date(now.getTime() + ZOHO_CONFIG.RECONCILIATION_LEASE_MS).toISOString();
  if (!pool.hasStorage()) return { claimed: true, leaseExpiresAt, durable: false };

  const rows = await pool.rows(
    `INSERT INTO zoho_reconciliation_claims (payment_link_id, lease_expires_at, claimed_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (payment_link_id) DO UPDATE SET
       lease_expires_at = EXCLUDED.lease_expires_at,
       claimed_at = EXCLUDED.claimed_at
     WHERE zoho_reconciliation_claims.lease_expires_at <= EXCLUDED.claimed_at
     RETURNING payment_link_id`,
    [normalizedId, leaseExpiresAt, nowIso],
    {
      ...DB_OPTIONS,
      d1Text: `INSERT INTO zoho_reconciliation_claims (payment_link_id, lease_expires_at, claimed_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (payment_link_id) DO UPDATE SET
         lease_expires_at = excluded.lease_expires_at,
         claimed_at = excluded.claimed_at
       WHERE zoho_reconciliation_claims.lease_expires_at <= excluded.claimed_at
       RETURNING payment_link_id`,
    }
  );

  if (rows.length === 0) return { claimed: false, reason: 'LEASE_HELD' };
  return { claimed: true, leaseExpiresAt, durable: true };
}

async function purgeExpiredPaymentLinkReconciliationClaims(now = new Date()) {
  if (!pool.hasStorage()) return 0;
  const result = await pool.query(
    'DELETE FROM zoho_reconciliation_claims WHERE lease_expires_at <= $1',
    [now.toISOString()],
    {
      ...DB_OPTIONS,
      d1Text: 'DELETE FROM zoho_reconciliation_claims WHERE lease_expires_at <= $1',
    }
  );
  return Number(result.rowCount || 0);
}

module.exports = {
  normalizePaymentLinkId,
  claimPaymentLinkReconciliation,
  purgeExpiredPaymentLinkReconciliationClaims,
};
