CREATE OR REPLACE FUNCTION queue_vendor_rating_revision_email_outbox()
RETURNS TRIGGER AS $$
DECLARE
  revision_id TEXT;
BEGIN
  revision_id := NEW.raw->'latestRatingRevision'->>'id';
  IF revision_id IS NULL OR revision_id = '' OR COALESCE(trim(NEW.email), '') = '' THEN
    RETURN NEW;
  END IF;

  INSERT INTO event_outbox (id, event_type, raw)
  VALUES (
    'vendor-rating-revision-email:' || revision_id,
    'vendor_rating_revision_email',
    jsonb_build_object(
      'vendorId', NEW.id,
      'revisionId', revision_id,
      'recipientEmail', NEW.email
    )
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS vendors_queue_rating_revision_email_outbox ON vendors;
CREATE TRIGGER vendors_queue_rating_revision_email_outbox
AFTER UPDATE OF raw, email ON vendors
FOR EACH ROW
WHEN (
  (NEW.raw->'latestRatingRevision'->>'id') IS NOT NULL
  AND (NEW.raw->'latestRatingRevision'->>'id') <> ''
  AND (NEW.raw->'latestRatingRevision'->>'id') IS DISTINCT FROM (OLD.raw->'latestRatingRevision'->>'id')
)
EXECUTE FUNCTION queue_vendor_rating_revision_email_outbox();
