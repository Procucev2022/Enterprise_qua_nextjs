CREATE TABLE IF NOT EXISTS vendor_presence (
  identifier TEXT PRIMARY KEY,
  vendor_id TEXT,
  status TEXT NOT NULL DEFAULT 'online' CHECK (status IN ('online', 'offline')),
  last_active_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vendor_presence_vendor_id ON vendor_presence (vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_presence_online_activity
  ON vendor_presence (status, last_active_at DESC);
