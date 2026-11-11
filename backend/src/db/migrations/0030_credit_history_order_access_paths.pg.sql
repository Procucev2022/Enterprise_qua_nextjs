DROP INDEX IF EXISTS idx_vendor_credit_transactions_vendor;
DROP INDEX IF EXISTS idx_buyer_credit_transactions_buyer;

CREATE INDEX IF NOT EXISTS idx_vendor_credit_transactions_vendor
  ON vendor_credit_transactions (vendor_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_buyer_credit_transactions_buyer
  ON buyer_credit_transactions (buyer_id, created_at DESC, id DESC);
