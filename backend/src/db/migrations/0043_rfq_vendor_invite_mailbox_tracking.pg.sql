-- 0043_rfq_vendor_invite_mailbox_tracking.pg.sql
--
-- PostgreSQL counterpart of 0043_rfq_vendor_invite_mailbox_tracking.d1.sql.
-- Tracks which dual-mailbox channel (invite vs direct), invite origin
-- (auto_matched_network, buyer_uploaded, cm_assigned, cm_created), sender
-- mailbox address, and reply-to-quote eligibility were assigned to each
-- RFQ-vendor invite record.

ALTER TABLE rfq_vendor_invites ADD COLUMN IF NOT EXISTS invite_channel VARCHAR(32);
ALTER TABLE rfq_vendor_invites ADD COLUMN IF NOT EXISTS invite_origin VARCHAR(64);
ALTER TABLE rfq_vendor_invites ADD COLUMN IF NOT EXISTS sender_mailbox VARCHAR(255);
ALTER TABLE rfq_vendor_invites ADD COLUMN IF NOT EXISTS reply_to_quote_allowed BOOLEAN;

CREATE INDEX IF NOT EXISTS idx_rfq_vendor_invites_channel
  ON rfq_vendor_invites (invite_channel, rfq_number);
