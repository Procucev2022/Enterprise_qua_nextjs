-- 0042_v0_vendor_quote_tracking_and_dispatch.pg.sql
--
-- PostgreSQL counterpart of 0042_v0_vendor_quote_tracking_and_dispatch.d1.sql.
-- Tracks outbound RFQ vendor invite Message-IDs for reliable reply threading
-- and records the 48-hour V0 quotation dispatch window and atomic dispatch
-- claim timestamp on rfqs.

ALTER TABLE rfqs ADD COLUMN IF NOT EXISTS quotes_dispatch_due_at TIMESTAMPTZ;
ALTER TABLE rfqs ADD COLUMN IF NOT EXISTS buyer_quotes_sent_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_rfqs_quotes_dispatch_due
  ON rfqs (quotes_dispatch_due_at, buyer_quotes_sent_at);

CREATE TABLE IF NOT EXISTS rfq_vendor_invites (
  id VARCHAR(128) PRIMARY KEY,
  rfq_id VARCHAR(64),
  rfq_number VARCHAR(100) NOT NULL,
  vendor_id VARCHAR(64),
  vendor_email VARCHAR(255) NOT NULL,
  invite_message_id VARCHAR(512),
  invited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (rfq_number, vendor_email)
);

CREATE INDEX IF NOT EXISTS idx_rfq_vendor_invites_message_id
  ON rfq_vendor_invites (invite_message_id);
CREATE INDEX IF NOT EXISTS idx_rfq_vendor_invites_vendor_email
  ON rfq_vendor_invites (vendor_email, invited_at DESC);
CREATE INDEX IF NOT EXISTS idx_rfq_vendor_invites_vendor_id
  ON rfq_vendor_invites (vendor_id, invited_at DESC);
