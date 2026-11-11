CREATE TABLE IF NOT EXISTS zoho_webhook_events (
  account_id VARCHAR(160) NOT NULL,
  event_id VARCHAR(255) NOT NULL,
  event_type VARCHAR(160) NOT NULL,
  payload_hash VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL CHECK (status IN ('PROCESSING', 'FAILED', 'PROCESSED')),
  attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
  lease_owner VARCHAR(64),
  lease_expires_at TIMESTAMPTZ NOT NULL,
  error_code VARCHAR(160),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  PRIMARY KEY (account_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_zoho_webhook_events_lease
  ON zoho_webhook_events (status, lease_expires_at);
CREATE INDEX IF NOT EXISTS idx_zoho_webhook_events_processed
  ON zoho_webhook_events (status, processed_at);
CREATE INDEX IF NOT EXISTS idx_zoho_webhook_events_failed_updated
  ON zoho_webhook_events (status, updated_at);
