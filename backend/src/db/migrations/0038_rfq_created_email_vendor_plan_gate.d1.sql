DROP TRIGGER IF EXISTS rfqs_enqueue_created_email_event;
CREATE TRIGGER rfqs_enqueue_created_email_event
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
    CASE WHEN COALESCE(json_extract(NEW.raw, '$.vendorPlanPending'), 0) = 1 THEN 'planning' ELSE 'pending' END,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  );
END;

DROP TRIGGER IF EXISTS rfqs_release_created_email_event;
CREATE TRIGGER rfqs_release_created_email_event
AFTER UPDATE OF raw ON rfqs
WHEN COALESCE(json_extract(NEW.raw, '$.vendorPlanPending'), 0) = 0
  AND COALESCE(json_extract(NEW.raw, '$.creationAcknowledgementRequested'), 0) = 1
  AND lower(COALESCE(json_extract(NEW.raw, '$.source'), '')) <> 'email_gateway'
  AND length(trim(COALESCE(json_extract(NEW.raw, '$.buyerEmail'), json_extract(NEW.raw, '$.raisedByEmail'), ''))) > 0
BEGIN
  UPDATE event_outbox
  SET status = 'pending',
      available_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = 'rfq-created-email:' || NEW.id
    AND status = 'planning';
END;
