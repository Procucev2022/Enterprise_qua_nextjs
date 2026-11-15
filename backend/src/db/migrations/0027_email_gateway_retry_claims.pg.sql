CREATE TABLE IF NOT EXISTS email_ingestion_retry_claims (
  message_id VARCHAR(512) PRIMARY KEY REFERENCES email_ingestion_log(message_id) ON DELETE CASCADE,
  claim_token VARCHAR(64) NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_email_ingestion_retry_claimed_at
  ON email_ingestion_retry_claims (claimed_at);

CREATE OR REPLACE FUNCTION clear_email_ingestion_retry_claim()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' OR NEW.status <> 'ACK_PENDING' THEN
    DELETE FROM email_ingestion_retry_claims WHERE message_id = OLD.message_id;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS email_ingestion_retry_claims_clear_after_status ON email_ingestion_log;
CREATE TRIGGER email_ingestion_retry_claims_clear_after_status
AFTER UPDATE OF status ON email_ingestion_log
FOR EACH ROW
WHEN (NEW.status <> 'ACK_PENDING')
EXECUTE FUNCTION clear_email_ingestion_retry_claim();

DROP TRIGGER IF EXISTS email_ingestion_retry_claims_clear_after_delete ON email_ingestion_log;
CREATE TRIGGER email_ingestion_retry_claims_clear_after_delete
AFTER DELETE ON email_ingestion_log
FOR EACH ROW
EXECUTE FUNCTION clear_email_ingestion_retry_claim();
