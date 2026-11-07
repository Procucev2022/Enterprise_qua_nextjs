CREATE OR REPLACE FUNCTION queue_communication_delivery_outbox()
RETURNS TRIGGER AS $$
BEGIN
  IF lower(NEW.channel) NOT IN ('email', 'sms')
    OR lower(NEW.delivery_status) <> 'pending'
    OR trim(COALESCE(NEW.recipient, '')) = '' THEN
    RETURN NEW;
  END IF;

  INSERT INTO event_outbox (id, event_type, raw)
  VALUES (
    'communication-delivery:' || NEW.id,
    'communication_delivery',
    jsonb_build_object('communicationId', NEW.id)
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS payment_dues_communications_queue_delivery_outbox ON payment_dues_communications;
CREATE TRIGGER payment_dues_communications_queue_delivery_outbox
AFTER INSERT ON payment_dues_communications
FOR EACH ROW
EXECUTE FUNCTION queue_communication_delivery_outbox();
