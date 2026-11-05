-- Temporary vendor credentials belong only in the identity credential store.
-- Remove historical plaintext mirrors from valid JSON vendor profiles.
UPDATE vendors
SET raw = json_remove(raw, '$.tempPassword')
WHERE json_valid(raw) AND json_type(raw, '$.tempPassword') IS NOT NULL;
