CREATE OR REPLACE FUNCTION queue_enterprise_inquiry_email_outbox()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO event_outbox (id, event_type, raw)
  VALUES
    (
      'enterprise-inquiry-email:' || NEW.id || ':team',
      'enterprise_inquiry_email',
      jsonb_build_object('inquiryId', NEW.id, 'notificationType', 'team')
    ),
    (
      'enterprise-inquiry-email:' || NEW.id || ':buyer_confirmation',
      'enterprise_inquiry_email',
      jsonb_build_object('inquiryId', NEW.id, 'notificationType', 'buyer_confirmation')
    )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS enterprise_inquiries_queue_email_outbox ON enterprise_inquiries;
CREATE TRIGGER enterprise_inquiries_queue_email_outbox
AFTER INSERT ON enterprise_inquiries
FOR EACH ROW
EXECUTE FUNCTION queue_enterprise_inquiry_email_outbox();
