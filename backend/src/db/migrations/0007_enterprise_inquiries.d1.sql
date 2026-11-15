CREATE TABLE IF NOT EXISTS enterprise_inquiries (
  id TEXT PRIMARY KEY,
  company_name TEXT NOT NULL,
  email TEXT NOT NULL,
  mobile TEXT NOT NULL,
  buyer_account_id TEXT,
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'NEW'
    CHECK (status IN ('NEW', 'CONTACTED', 'IN_DISCUSSION', 'CONTRACT_SIGNED', 'CLOSED')),
  contacted_by TEXT,
  contacted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_enterprise_inquiries_created
  ON enterprise_inquiries (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_enterprise_inquiries_status_created
  ON enterprise_inquiries (status, created_at DESC, id DESC);
