CREATE TABLE IF NOT EXISTS enterprise_inquiries (
  id VARCHAR(64) PRIMARY KEY,
  company_name VARCHAR(200) NOT NULL,
  email VARCHAR(320) NOT NULL,
  mobile VARCHAR(32) NOT NULL,
  buyer_account_id VARCHAR(64),
  notes TEXT NOT NULL DEFAULT '',
  status VARCHAR(32) NOT NULL DEFAULT 'NEW'
    CHECK (status IN ('NEW', 'CONTACTED', 'IN_DISCUSSION', 'CONTRACT_SIGNED', 'CLOSED')),
  contacted_by VARCHAR(160),
  contacted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_enterprise_inquiries_created
  ON enterprise_inquiries (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_enterprise_inquiries_status_created
  ON enterprise_inquiries (status, created_at DESC, id DESC);
