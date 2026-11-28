-- 0039_vendor_email_search_indexes.pg.sql
--
-- PostgreSQL counterpart of 0039_vendor_email_search_indexes.d1.sql.
-- Ensures case-insensitive lookup indexes exist on vendor emails.
CREATE INDEX IF NOT EXISTS idx_vendors_email_lower ON vendors (lower(email));
CREATE INDEX IF NOT EXISTS idx_vendors_raw_corp_email_lower ON vendors (lower(raw->>'corporateEmail'));
