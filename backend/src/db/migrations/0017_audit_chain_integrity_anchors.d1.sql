ALTER TABLE audit_chain_state ADD COLUMN root_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE audit_chain_state ADD COLUMN entry_count INTEGER NOT NULL DEFAULT 0;

UPDATE audit_chain_state
SET root_hash = CASE WHEN root_hash = '' THEN COALESCE(
      (SELECT json_extract(raw, '$.shaSignature') FROM audit_logs ORDER BY rowid ASC LIMIT 1),
      ''
    ) ELSE root_hash END,
    entry_count = CASE WHEN entry_count = 0 THEN (SELECT COUNT(*) FROM audit_logs) ELSE entry_count END
WHERE id = 1;
