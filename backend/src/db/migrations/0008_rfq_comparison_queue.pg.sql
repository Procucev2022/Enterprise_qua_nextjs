CREATE TABLE IF NOT EXISTS rfq_comparison_queue (
  id VARCHAR(64) PRIMARY KEY,
  rfq_id VARCHAR(64) NOT NULL UNIQUE,
  rfq_number VARCHAR(128) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  fire_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  email_completed_at TIMESTAMPTZ,
  sms_completed_at TIMESTAMPTZ,
  last_error TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rfq_comparison_queue_status_fire_at
  ON rfq_comparison_queue (status, fire_at);
