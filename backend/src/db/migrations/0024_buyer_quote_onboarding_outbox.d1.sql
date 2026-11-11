CREATE INDEX IF NOT EXISTS idx_event_outbox_onboarding_recipient
  ON event_outbox (lower(json_extract(raw, '$.recipientEmail')))
  WHERE status = 'onboarding' AND event_type = 'rfq_quote_received_email';

CREATE INDEX IF NOT EXISTS idx_event_outbox_onboarding_created
  ON event_outbox (created_at)
  WHERE status = 'onboarding' AND event_type = 'rfq_quote_received_email';
