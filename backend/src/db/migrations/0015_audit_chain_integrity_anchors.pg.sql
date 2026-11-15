ALTER TABLE audit_chain_state
  ADD COLUMN root_hash VARCHAR(64) NOT NULL DEFAULT '',
  ADD COLUMN entry_count BIGINT NOT NULL DEFAULT 0;

UPDATE audit_chain_state
SET root_hash = CASE WHEN root_hash = '' THEN COALESCE(
      (SELECT raw->>'shaSignature' FROM audit_logs ORDER BY sequence ASC LIMIT 1),
      ''
    ) ELSE root_hash END,
    entry_count = CASE WHEN entry_count = 0 THEN (SELECT COUNT(*) FROM audit_logs) ELSE entry_count END
WHERE id = 1;
