DROP TRIGGER IF EXISTS rfqs_enqueue_gateway_notification_email_after_insert;
CREATE TRIGGER rfqs_enqueue_gateway_notification_email_after_insert
AFTER INSERT ON rfqs
WHEN json_type(NEW.raw, '$.gatewayNotificationTarget') = 'object'
  AND length(trim(COALESCE(json_extract(NEW.raw, '$.gatewayNotificationTarget.recipientEmail'), ''))) BETWEEN 1 AND 320
  AND length(trim(COALESCE(json_extract(NEW.raw, '$.gatewayNotificationTarget.sourceEmail'), ''))) <= 320
BEGIN
  INSERT OR IGNORE INTO event_outbox (id, event_type, raw, status, available_at, created_at, updated_at)
  VALUES (
    'rfq-gateway-email:' || NEW.id,
    'rfq_gateway_notification_email',
    json_object('rfqId', NEW.id),
    'pending',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  );
END;

DROP TRIGGER IF EXISTS rfqs_enqueue_gateway_notification_email_after_update;
CREATE TRIGGER rfqs_enqueue_gateway_notification_email_after_update
AFTER UPDATE OF raw ON rfqs
WHEN json_type(NEW.raw, '$.gatewayNotificationTarget') = 'object'
  AND json_extract(NEW.raw, '$.gatewayNotificationTarget') IS NOT json_extract(OLD.raw, '$.gatewayNotificationTarget')
  AND length(trim(COALESCE(json_extract(NEW.raw, '$.gatewayNotificationTarget.recipientEmail'), ''))) BETWEEN 1 AND 320
  AND length(trim(COALESCE(json_extract(NEW.raw, '$.gatewayNotificationTarget.sourceEmail'), ''))) <= 320
BEGIN
  INSERT OR IGNORE INTO event_outbox (id, event_type, raw, status, available_at, created_at, updated_at)
  VALUES (
    'rfq-gateway-email:' || NEW.id,
    'rfq_gateway_notification_email',
    json_object('rfqId', NEW.id),
    'pending',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  );
END;
