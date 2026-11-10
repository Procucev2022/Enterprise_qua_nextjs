DROP INDEX IF EXISTS idx_vendor_catalogue_vendor_id;

CREATE INDEX IF NOT EXISTS idx_vendor_catalogue_created_at_id
  ON vendor_catalogue (created_at, id);
CREATE INDEX IF NOT EXISTS idx_vendor_catalogue_vendor_created_at_id
  ON vendor_catalogue (vendor_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_vendor_catalogue_vendor_sku_normalized
  ON vendor_catalogue (vendor_id, lower(trim(sku)));
