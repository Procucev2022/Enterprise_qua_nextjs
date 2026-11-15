CREATE TABLE IF NOT EXISTS rfq_comparison_queue (
  id TEXT PRIMARY KEY,
  rfq_id TEXT NOT NULL UNIQUE,
  rfq_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  fire_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  email_completed_at TEXT,
  sms_completed_at TEXT,
  last_error TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_rfq_comparison_queue_status_fire_at
  ON rfq_comparison_queue (status, fire_at);
