-- 0037_vendor_pincode_indexes.pg.sql
--
-- PostgreSQL counterpart of 0037_vendor_pincode_indexes.d1.sql.
-- Serves progressive delivery-pincode proximity range lookups inside a division
-- using lower(major_category) and btrim(coalesce(raw->>'pincode', '')).
CREATE INDEX IF NOT EXISTS idx_vendors_major_lower_pincode_created_at
  ON vendors (
    lower(major_category),
    btrim(coalesce(raw->>'pincode', '')),
    created_at DESC
  );
