CREATE TRIGGER IF NOT EXISTS enterprise_inquiries_queue_email_outbox
AFTER INSERT ON enterprise_inquiries
BEGIN
  INSERT OR IGNORE INTO event_outbox (id, event_type, raw)
  VALUES (
    'enterprise-inquiry-email:' || NEW.id || ':team',
    'enterprise_inquiry_email',
    json_object('inquiryId', NEW.id, 'notificationType', 'team')
  );
  INSERT OR IGNORE INTO event_outbox (id, event_type, raw)
  VALUES (
    'enterprise-inquiry-email:' || NEW.id || ':buyer_confirmation',
    'enterprise_inquiry_email',
    json_object('inquiryId', NEW.id, 'notificationType', 'buyer_confirmation')
  );
END;
