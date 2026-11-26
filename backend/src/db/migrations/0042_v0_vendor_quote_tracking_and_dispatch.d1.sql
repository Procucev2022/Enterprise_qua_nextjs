-- 0042_v0_vendor_quote_tracking_and_dispatch.d1.sql
--
-- Tracks outbound RFQ vendor invite Message-IDs for reliable reply threading
-- and records the 48-hour V0 quotation dispatch window and atomic dispatch
-- claim timestamp on rfqs.

ALTER TABLE rfqs ADD COLUMN quotes_dispatch_due_at TEXT;
ALTER TABLE rfqs ADD COLUMN buyer_quotes_sent_at TEXT;

CREATE INDEX IF NOT EXISTS idx_rfqs_quotes_dispatch_due
  ON rfqs (quotes_dispatch_due_at, buyer_quotes_sent_at);

CREATE TABLE IF NOT EXISTS rfq_vendor_invites (
  id TEXT PRIMARY KEY,
  rfq_id TEXT,
  rfq_number TEXT NOT NULL,
  vendor_id TEXT,
  vendor_email TEXT NOT NULL,
  invite_message_id TEXT,
  invited_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (rfq_number, vendor_email)
);

CREATE INDEX IF NOT EXISTS idx_rfq_vendor_invites_message_id
  ON rfq_vendor_invites (invite_message_id);
CREATE INDEX IF NOT EXISTS idx_rfq_vendor_invites_vendor_email
  ON rfq_vendor_invites (vendor_email, invited_at DESC);
CREATE INDEX IF NOT EXISTS idx_rfq_vendor_invites_vendor_id
  ON rfq_vendor_invites (vendor_id, invited_at DESC);
