CREATE TRIGGER IF NOT EXISTS rfqs_enqueue_created_email_event
AFTER INSERT ON rfqs
WHEN COALESCE(json_extract(NEW.raw, '$.creationAcknowledgementRequested'), 0) = 1
  AND lower(COALESCE(json_extract(NEW.raw, '$.source'), '')) <> 'email_gateway'
  AND length(trim(COALESCE(json_extract(NEW.raw, '$.buyerEmail'), json_extract(NEW.raw, '$.raisedByEmail'), ''))) > 0
BEGIN
  INSERT OR IGNORE INTO event_outbox (id, event_type, raw, status, available_at, created_at, updated_at)
  VALUES (
    'rfq-created-email:' || NEW.id,
    'rfq_created_email',
    json_object('rfqId', NEW.id),
    'pending',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  );
END;
