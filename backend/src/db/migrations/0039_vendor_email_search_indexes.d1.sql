-- 0039_vendor_email_search_indexes.d1.sql
--
-- Ensure B-tree case-insensitive indexes on vendors email and raw corporateEmail
-- exist on pre-baseline D1 databases so email lookups in getVendorsPageFromDB
-- execute as O(log N) index searches rather than full-table scans.
CREATE INDEX IF NOT EXISTS idx_vendors_email_nocase ON vendors (email COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_vendors_corp_email_nocase ON vendors (json_extract(raw, '$.corporateEmail') COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_vendors_name_nocase ON vendors (json_extract(raw, '$.name') COLLATE NOCASE);
