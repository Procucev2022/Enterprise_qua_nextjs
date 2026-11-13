-- 0031_public_vendor_listing_index.pg.sql
--
-- PostgreSQL counterpart of the D1 partial index in 0031_public_vendor_listing_index.d1.sql.
-- The PostgreSQL publicOnly predicate in domainQueries.js has no source clause, so this
-- index predicate contains only the two owner checks.
CREATE INDEX IF NOT EXISTS idx_vendors_public_created_at ON vendors (created_at DESC)
  WHERE lower(raw->>'buyerId') IS NULL AND lower(raw->>'buyerAccountId') IS NULL;
