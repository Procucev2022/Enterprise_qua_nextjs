-- 0037_vendor_pincode_indexes.d1.sql
--
-- Composite index accelerating progressive delivery-pincode proximity lookups
-- (exact 6-digit PIN, 3-digit postal district range, 2-digit sub-region range,
-- and 1-digit postal zone range) inside a division (major_category COLLATE NOCASE)
-- without scanning all rows in populous categories.
CREATE INDEX IF NOT EXISTS idx_vendors_major_pincode_created_at
  ON vendors (
    major_category COLLATE NOCASE,
    trim(coalesce(CAST(json_extract(raw, '$.pincode') AS TEXT), '')),
    created_at DESC
  );
