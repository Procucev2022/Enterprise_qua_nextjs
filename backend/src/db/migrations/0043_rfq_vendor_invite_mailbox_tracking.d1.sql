-- 0043_rfq_vendor_invite_mailbox_tracking.d1.sql
--
-- Tracks which dual-mailbox channel (invite vs direct), invite origin
-- (auto_matched_network, buyer_uploaded, cm_assigned, cm_created), sender
-- mailbox address, and reply-to-quote eligibility were assigned to each
-- RFQ-vendor invite record so inbound handling and reminders stay consistent.

ALTER TABLE rfq_vendor_invites ADD COLUMN invite_channel TEXT;
ALTER TABLE rfq_vendor_invites ADD COLUMN invite_origin TEXT;
ALTER TABLE rfq_vendor_invites ADD COLUMN sender_mailbox TEXT;
ALTER TABLE rfq_vendor_invites ADD COLUMN reply_to_quote_allowed INTEGER;

CREATE INDEX IF NOT EXISTS idx_rfq_vendor_invites_channel
  ON rfq_vendor_invites (invite_channel, rfq_number);
