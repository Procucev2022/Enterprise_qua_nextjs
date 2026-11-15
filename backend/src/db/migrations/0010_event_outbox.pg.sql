CREATE TABLE IF NOT EXISTS event_outbox (
  id VARCHAR(160) PRIMARY KEY,
  event_type VARCHAR(32) NOT NULL,
  raw JSONB NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_until TIMESTAMPTZ,
  lease_token VARCHAR(64),
  last_error VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_event_outbox_status_available
  ON event_outbox (status, available_at, created_at);
CREATE INDEX IF NOT EXISTS idx_event_outbox_completed_at
  ON event_outbox (completed_at)
  WHERE status = 'completed';
