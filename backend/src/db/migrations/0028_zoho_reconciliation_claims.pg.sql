CREATE TABLE IF NOT EXISTS zoho_reconciliation_claims (
  payment_link_id VARCHAR(64) PRIMARY KEY REFERENCES payment_links(id) ON DELETE CASCADE,
  lease_expires_at TIMESTAMPTZ NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_zoho_reconciliation_claims_expires_at
  ON zoho_reconciliation_claims (lease_expires_at);
