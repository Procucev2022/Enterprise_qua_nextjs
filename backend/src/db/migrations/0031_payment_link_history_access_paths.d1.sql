DROP INDEX IF EXISTS idx_payment_links_vendor_id;
DROP INDEX IF EXISTS idx_payment_links_buyer_account_id;

CREATE INDEX IF NOT EXISTS idx_payment_links_vendor_history
  ON payment_links (vendor_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_payment_links_buyer_history
  ON payment_links (buyer_account_id, created_at DESC, id DESC);
