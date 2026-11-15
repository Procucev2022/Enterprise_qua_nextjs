DROP TRIGGER IF EXISTS rfqs_enqueue_vendor_invitation_email_after_insert;
CREATE TRIGGER rfqs_enqueue_vendor_invitation_email_after_insert
AFTER INSERT ON rfqs
WHEN json_type(NEW.raw, '$.vendorInvitationTargets') = 'array'
BEGIN
  INSERT OR IGNORE INTO event_outbox (id, event_type, raw, status, available_at, created_at, updated_at)
  SELECT
    'rfq-vendor-invite:' || json_extract(target.value, '$.key'),
    'rfq_vendor_invite_email',
    json_object('rfqId', NEW.id, 'target', json(target.value)),
    'pending',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  FROM json_each(NEW.raw, '$.vendorInvitationTargets') AS target
  WHERE length(trim(COALESCE(json_extract(target.value, '$.key'), ''))) = 64
    AND length(trim(COALESCE(json_extract(target.value, '$.recipientEmail'), ''))) BETWEEN 1 AND 320;
END;

DROP TRIGGER IF EXISTS rfqs_enqueue_vendor_invitation_email_after_update;
CREATE TRIGGER rfqs_enqueue_vendor_invitation_email_after_update
AFTER UPDATE OF raw ON rfqs
WHEN json_type(NEW.raw, '$.vendorInvitationTargets') = 'array'
  AND json_extract(NEW.raw, '$.vendorInvitationTargets') IS NOT json_extract(OLD.raw, '$.vendorInvitationTargets')
BEGIN
  INSERT OR IGNORE INTO event_outbox (id, event_type, raw, status, available_at, created_at, updated_at)
  SELECT
    'rfq-vendor-invite:' || json_extract(target.value, '$.key'),
    'rfq_vendor_invite_email',
    json_object('rfqId', NEW.id, 'target', json(target.value)),
    'pending',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  FROM json_each(NEW.raw, '$.vendorInvitationTargets') AS target
  WHERE length(trim(COALESCE(json_extract(target.value, '$.key'), ''))) = 64
    AND length(trim(COALESCE(json_extract(target.value, '$.recipientEmail'), ''))) BETWEEN 1 AND 320;
END;
