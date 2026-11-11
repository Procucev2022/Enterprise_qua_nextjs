CREATE TABLE IF NOT EXISTS zoho_reconciliation_claims (
  payment_link_id TEXT PRIMARY KEY REFERENCES payment_links(id) ON DELETE CASCADE,
  lease_expires_at TEXT NOT NULL,
  claimed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_zoho_reconciliation_claims_expires_at
  ON zoho_reconciliation_claims (lease_expires_at);
