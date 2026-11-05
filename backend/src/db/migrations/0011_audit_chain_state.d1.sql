CREATE TABLE IF NOT EXISTS audit_chain_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  head_hash TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO audit_chain_state (id, head_hash, revision)
SELECT
  1,
  COALESCE((SELECT json_extract(raw, '$.shaSignature') FROM audit_logs ORDER BY rowid DESC LIMIT 1), ''),
  COALESCE((SELECT rowid FROM audit_logs ORDER BY rowid DESC LIMIT 1), 0);
