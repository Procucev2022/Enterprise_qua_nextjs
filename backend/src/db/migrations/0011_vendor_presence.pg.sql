CREATE TABLE IF NOT EXISTS vendor_presence (
  identifier VARCHAR(255) PRIMARY KEY,
  vendor_id VARCHAR(64),
  status VARCHAR(16) NOT NULL DEFAULT 'online',
  last_active_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  CONSTRAINT vendor_presence_status_check CHECK (status IN ('online', 'offline'))
);

CREATE INDEX IF NOT EXISTS idx_vendor_presence_vendor_id ON vendor_presence (vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_presence_online_activity
  ON vendor_presence (status, last_active_at DESC);
