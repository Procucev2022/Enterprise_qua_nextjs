CREATE TABLE IF NOT EXISTS email_ingestion_retry_claims (
  message_id TEXT PRIMARY KEY REFERENCES email_ingestion_log(message_id) ON DELETE CASCADE,
  claim_token TEXT NOT NULL,
  claimed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_email_ingestion_retry_claimed_at
  ON email_ingestion_retry_claims (claimed_at);

CREATE TRIGGER IF NOT EXISTS email_ingestion_retry_claims_clear_after_status
AFTER UPDATE OF status ON email_ingestion_log
WHEN NEW.status <> 'ACK_PENDING'
BEGIN
  DELETE FROM email_ingestion_retry_claims WHERE message_id = NEW.message_id;
END;

CREATE TRIGGER IF NOT EXISTS email_ingestion_retry_claims_clear_after_delete
AFTER DELETE ON email_ingestion_log
BEGIN
  DELETE FROM email_ingestion_retry_claims WHERE message_id = OLD.message_id;
END;
