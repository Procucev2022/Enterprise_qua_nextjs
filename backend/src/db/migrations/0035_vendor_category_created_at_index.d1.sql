-- 0035_vendor_category_created_at_index.d1.sql
--
-- Composite index covering paginated category-filtered vendor directory reads
-- (domainQueries.getVendorsPageFromDB with `WHERE major_category = ? COLLATE NOCASE ORDER BY created_at DESC LIMIT ? OFFSET ?`)
-- as well as public major-category vendor lookups (`WHERE major_category COLLATE NOCASE IN (...) ORDER BY created_at DESC`).
-- Without created_at DESC inside the index, SQLite must materialize and sort all matching rows in a large division
-- (100k+ IT/Industrial rows) on every page=1 request instead of reading only LIMIT rows.
CREATE INDEX IF NOT EXISTS idx_vendors_major_category_created_at ON vendors (major_category COLLATE NOCASE, created_at DESC);
