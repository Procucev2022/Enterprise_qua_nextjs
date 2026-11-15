CREATE TRIGGER IF NOT EXISTS vendors_queue_rating_revision_email_outbox
AFTER UPDATE OF raw, email ON vendors
WHEN json_extract(NEW.raw, '$.latestRatingRevision.id') IS NOT NULL
  AND json_extract(NEW.raw, '$.latestRatingRevision.id') <> ''
  AND json_extract(NEW.raw, '$.latestRatingRevision.id') IS NOT json_extract(OLD.raw, '$.latestRatingRevision.id')
  AND NEW.email IS NOT NULL
  AND trim(NEW.email) <> ''
BEGIN
  INSERT OR IGNORE INTO event_outbox (id, event_type, raw)
  VALUES (
    'vendor-rating-revision-email:' || json_extract(NEW.raw, '$.latestRatingRevision.id'),
    'vendor_rating_revision_email',
    json_object(
      'vendorId', NEW.id,
      'revisionId', json_extract(NEW.raw, '$.latestRatingRevision.id'),
      'recipientEmail', NEW.email
    )
  );
END;
