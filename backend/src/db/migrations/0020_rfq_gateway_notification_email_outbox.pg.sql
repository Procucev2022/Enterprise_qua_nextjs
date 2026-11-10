CREATE OR REPLACE FUNCTION enqueue_rfq_gateway_notification_email()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  target JSONB;
  recipient_email TEXT;
  source_email TEXT;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.raw->'gatewayNotificationTarget' IS NOT DISTINCT FROM OLD.raw->'gatewayNotificationTarget' THEN
    RETURN NEW;
  END IF;

  target := NEW.raw->'gatewayNotificationTarget';
  IF jsonb_typeof(target) IS DISTINCT FROM 'object' THEN
    RETURN NEW;
  END IF;

  recipient_email := NULLIF(btrim(target->>'recipientEmail'), '');
  source_email := NULLIF(btrim(target->>'sourceEmail'), '');
  IF recipient_email IS NULL OR length(recipient_email) > 320 OR length(COALESCE(source_email, '')) > 320 THEN
    RETURN NEW;
  END IF;

  INSERT INTO event_outbox (id, event_type, raw, status, available_at, created_at, updated_at)
  VALUES (
    'rfq-gateway-email:' || NEW.id,
    'rfq_gateway_notification_email',
    jsonb_build_object('rfqId', NEW.id),
    'pending',
    now(),
    now(),
    now()
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rfqs_enqueue_gateway_notification_email_after_insert ON rfqs;
CREATE TRIGGER rfqs_enqueue_gateway_notification_email_after_insert
AFTER INSERT ON rfqs
FOR EACH ROW
EXECUTE FUNCTION enqueue_rfq_gateway_notification_email();

DROP TRIGGER IF EXISTS rfqs_enqueue_gateway_notification_email_after_update ON rfqs;
CREATE TRIGGER rfqs_enqueue_gateway_notification_email_after_update
AFTER UPDATE OF raw ON rfqs
FOR EACH ROW
EXECUTE FUNCTION enqueue_rfq_gateway_notification_email();
