-- Match case-insensitive buyer ownership predicates exactly. The prior indexes
-- omitted lower() and buyerEmail, so SQLite could not use them for the owner
-- OR branches and fell back to scanning vendors.
DROP INDEX IF EXISTS idx_vendors_buyer_id;
DROP INDEX IF EXISTS idx_vendors_buyer_account_id;

CREATE INDEX IF NOT EXISTS idx_vendors_buyer_id_lower
  ON vendors (lower(json_extract(raw, '$.buyerId')));
CREATE INDEX IF NOT EXISTS idx_vendors_buyer_account_id_lower
  ON vendors (lower(json_extract(raw, '$.buyerAccountId')));
CREATE INDEX IF NOT EXISTS idx_vendors_buyer_email_lower
  ON vendors (lower(json_extract(raw, '$.buyerEmail')));
