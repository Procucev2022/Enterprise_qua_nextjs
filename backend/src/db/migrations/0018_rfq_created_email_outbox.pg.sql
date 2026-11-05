CREATE OR REPLACE FUNCTION enqueue_rfq_created_email_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF COALESCE(NEW.raw -> 'creationAcknowledgementRequested', 'false'::jsonb) = 'true'::jsonb
     AND lower(COALESCE(NEW.raw ->> 'source', '')) <> 'email_gateway'
     AND NULLIF(btrim(COALESCE(NEW.raw ->> 'buyerEmail', NEW.raw ->> 'raisedByEmail', '')), '') IS NOT NULL THEN
    INSERT INTO event_outbox (id, event_type, raw, status, available_at, created_at, updated_at)
    VALUES (
      'rfq-created-email:' || NEW.id,
      'rfq_created_email',
      jsonb_build_object('rfqId', NEW.id),
      'pending',
      now(),
      now(),
      now()
    )
    ON CONFLICT (id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rfqs_enqueue_created_email_event ON rfqs;
CREATE TRIGGER rfqs_enqueue_created_email_event
AFTER INSERT ON rfqs
FOR EACH ROW
EXECUTE FUNCTION enqueue_rfq_created_email_event();
