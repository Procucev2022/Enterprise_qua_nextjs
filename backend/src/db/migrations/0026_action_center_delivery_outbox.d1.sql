ALTER TABLE payment_dues_communications ADD COLUMN notification_status TEXT NOT NULL DEFAULT 'Notification Sent';
ALTER TABLE payment_dues_communications ADD COLUMN delivery_status TEXT NOT NULL DEFAULT 'Delivered';
ALTER TABLE payment_dues_communications ADD COLUMN acknowledgement_status TEXT NOT NULL DEFAULT 'Acknowledgement Pending';
ALTER TABLE payment_dues_communications ADD COLUMN communicated_by TEXT NOT NULL DEFAULT 'Category Manager';
ALTER TABLE payment_dues_communications ADD COLUMN acknowledged_at TEXT;
ALTER TABLE payment_dues_communications ADD COLUMN acknowledged_by TEXT;
ALTER TABLE payment_dues_communications ADD COLUMN notes TEXT NOT NULL DEFAULT '';

DROP TRIGGER IF EXISTS payment_dues_communications_queue_delivery_outbox;
CREATE TRIGGER payment_dues_communications_queue_delivery_outbox
AFTER INSERT ON payment_dues_communications
WHEN lower(NEW.channel) IN ('email', 'sms', 'both')
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

INSERT OR IGNORE INTO event_outbox (id, event_type, raw)
SELECT
  'communication-delivery:' || id,
  'communication_delivery',
  json_object('communicationId', id)
FROM payment_dues_communications
WHERE lower(channel) IN ('email', 'sms', 'both')
  AND lower(delivery_status) = 'pending'
  AND trim(recipient) <> '';
