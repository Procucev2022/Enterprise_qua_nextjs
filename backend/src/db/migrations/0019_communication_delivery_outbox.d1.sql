CREATE TRIGGER IF NOT EXISTS payment_dues_communications_queue_delivery_outbox
AFTER INSERT ON payment_dues_communications
WHEN lower(NEW.channel) IN ('email', 'sms')
  AND lower(NEW.delivery_status) = 'pending'
  AND trim(NEW.recipient) <> ''
BEGIN
  INSERT OR IGNORE INTO event_outbox (id, event_type, raw)
  VALUES (
    'communication-delivery:' || NEW.id,
    'communication_delivery',
    json_object('communicationId', NEW.id)
  );
END;
