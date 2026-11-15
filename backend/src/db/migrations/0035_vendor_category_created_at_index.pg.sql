-- 0035_vendor_category_created_at_index.pg.sql
--
-- PostgreSQL counterpart of 0035_vendor_category_created_at_index.d1.sql.
-- Serves case-insensitive major-category lookups ordered by created_at DESC without sorting all rows in large divisions.
CREATE INDEX IF NOT EXISTS idx_vendors_major_category_lower_created_at ON vendors (lower(major_category), created_at DESC);
