CREATE TABLE IF NOT EXISTS zoho_webhook_events (
  account_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PROCESSING', 'FAILED', 'PROCESSED')),
  attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
  lease_owner TEXT,
  lease_expires_at TEXT NOT NULL,
  error_code TEXT,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TEXT,
  PRIMARY KEY (account_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_zoho_webhook_events_lease
  ON zoho_webhook_events (status, lease_expires_at);
CREATE INDEX IF NOT EXISTS idx_zoho_webhook_events_processed
  ON zoho_webhook_events (status, processed_at);
CREATE INDEX IF NOT EXISTS idx_zoho_webhook_events_failed_updated
  ON zoho_webhook_events (status, updated_at);
