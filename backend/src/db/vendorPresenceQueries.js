const pool = require('./pool');

async function upsertVendorPresence({ identifier, vendorId, status, timestamp, writeCutoff }) {
  const result = await pool.query(
    `INSERT INTO vendor_presence (identifier, vendor_id, status, last_active_at, updated_at)
     VALUES ($1, COALESCE((SELECT id FROM vendors WHERE email = $1 LIMIT 1), $2), $3, $4, $4)
     ON CONFLICT (identifier) DO UPDATE SET
       vendor_id = COALESCE((SELECT id FROM vendors WHERE email = $1 LIMIT 1), EXCLUDED.vendor_id),
       status = EXCLUDED.status,
       last_active_at = EXCLUDED.last_active_at,
       updated_at = EXCLUDED.updated_at
     WHERE vendor_presence.status <> EXCLUDED.status
        OR vendor_presence.last_active_at <= $5
     RETURNING identifier, vendor_id, status, last_active_at`,
    [identifier, vendorId, status, timestamp, writeCutoff],
    { d1: true }
  );

  if (result.rows?.[0]) return result.rows[0];

  const existing = await pool.query(
    'SELECT identifier, vendor_id, status, last_active_at FROM vendor_presence WHERE identifier = $1 LIMIT 1',
    [identifier],
    { d1: true }
  );
  return existing.rows?.[0] || null;
}

async function getVendorPresenceByIdentifiers(identifiers) {
  if (!Array.isArray(identifiers) || identifiers.length === 0) return [];
  const identifierParams = identifiers.map((_, index) => `$${index + 1}`).join(', ');
  const vendorIdParams = identifiers.map((_, index) => `$${identifiers.length + index + 1}`).join(', ');
  const result = await pool.query(
    `SELECT identifier, vendor_id, status, last_active_at
     FROM vendor_presence
     WHERE identifier IN (${identifierParams}) OR vendor_id IN (${vendorIdParams})`,
    [...identifiers, ...identifiers],
    { d1: true }
  );
  return result.rows || [];
}

async function getRecentOnlineVendorPresence({ cutoff, limit }) {
  const result = await pool.query(
    `SELECT identifier, vendor_id, status, last_active_at
     FROM vendor_presence
     WHERE status = 'online' AND last_active_at >= $1
     ORDER BY last_active_at DESC
     LIMIT $2`,
    [cutoff, limit],
    { d1: true }
  );
  return result.rows || [];
}

module.exports = {
  upsertVendorPresence,
  getVendorPresenceByIdentifiers,
  getRecentOnlineVendorPresence,
};
