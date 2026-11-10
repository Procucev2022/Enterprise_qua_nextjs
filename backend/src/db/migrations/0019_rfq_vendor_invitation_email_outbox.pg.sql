CREATE OR REPLACE FUNCTION enqueue_rfq_vendor_invitation_email_outbox()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  invite_target JSONB;
  target_key TEXT;
  recipient_email TEXT;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.raw->'vendorInvitationTargets' IS NOT DISTINCT FROM OLD.raw->'vendorInvitationTargets' THEN
    RETURN NEW;
  END IF;

  IF jsonb_typeof(NEW.raw->'vendorInvitationTargets') IS DISTINCT FROM 'array' THEN
    RETURN NEW;
  END IF;

  FOR invite_target IN
    SELECT value FROM jsonb_array_elements(NEW.raw->'vendorInvitationTargets') AS targets(value)
  LOOP
    target_key := NULLIF(btrim(invite_target->>'key'), '');
    recipient_email := NULLIF(btrim(invite_target->>'recipientEmail'), '');
    IF target_key IS NULL OR length(target_key) <> 64
       OR recipient_email IS NULL OR length(recipient_email) > 320 THEN
      CONTINUE;
    END IF;

    INSERT INTO event_outbox (id, event_type, raw, status, available_at, created_at, updated_at)
    VALUES (
      'rfq-vendor-invite:' || target_key,
      'rfq_vendor_invite_email',
      jsonb_build_object('rfqId', NEW.id, 'target', invite_target),
      'pending',
      now(),
      now(),
      now()
    )
    ON CONFLICT (id) DO NOTHING;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rfqs_enqueue_vendor_invitation_email_after_insert ON rfqs;
CREATE TRIGGER rfqs_enqueue_vendor_invitation_email_after_insert
AFTER INSERT ON rfqs
FOR EACH ROW
EXECUTE FUNCTION enqueue_rfq_vendor_invitation_email_outbox();

DROP TRIGGER IF EXISTS rfqs_enqueue_vendor_invitation_email_after_update ON rfqs;
CREATE TRIGGER rfqs_enqueue_vendor_invitation_email_after_update
AFTER UPDATE OF raw ON rfqs
FOR EACH ROW
EXECUTE FUNCTION enqueue_rfq_vendor_invitation_email_outbox();
