-- Temporary vendor credentials belong only in the identity credential store.
-- Remove historical plaintext mirrors from the JSONB vendor profile.
UPDATE vendors
SET raw = raw - 'tempPassword'
WHERE raw ? 'tempPassword';
