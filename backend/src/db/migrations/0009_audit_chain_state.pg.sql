CREATE TABLE IF NOT EXISTS audit_chain_state (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  head_hash VARCHAR(64) NOT NULL DEFAULT '',
  revision BIGINT NOT NULL DEFAULT 0
);

INSERT INTO audit_chain_state (id, head_hash, revision)
SELECT
  1,
  COALESCE((SELECT raw->>'shaSignature' FROM audit_logs ORDER BY sequence DESC LIMIT 1), ''),
  COALESCE((SELECT sequence FROM audit_logs ORDER BY sequence DESC LIMIT 1), 0)
ON CONFLICT (id) DO NOTHING;
