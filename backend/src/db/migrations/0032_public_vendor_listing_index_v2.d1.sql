-- 0032_public_vendor_listing_index_v2.d1.sql
--
-- Replaces the partial index created by 0031. After 0031 was applied on the test database,
-- the planner still did not use idx_vendors_public_created_at for the publicOnly hydration
-- query. The 0031 predicate wrapped the owner checks in lower(), and the expression indexes
-- from 0025 on lower(json_extract(raw, '$.buyerId')) and lower(json_extract(raw,
-- '$.buyerAccountId')) matched the IS NULL checks instead. The planner searched those
-- indexes and sorted the matches with a temporary B-tree, so each query read about 1.9 million
-- rows.
--
-- lower() does not change whether a value is NULL, so the owner checks below select the same
-- rows. Without lower(), the 0025 expression indexes cannot match, and SQLite uses this
-- partial index for the newest-first page. The WHERE clause must stay term for term identical
-- to the publicOnly D1 predicate in domainQueries.js. backend/__tests__/publicVendorListingIndex.test.js
-- checks that both texts still match.
DROP INDEX IF EXISTS idx_vendors_public_created_at;

CREATE INDEX IF NOT EXISTS idx_vendors_public_created_at ON vendors (created_at DESC)
  WHERE (source IS NULL OR source NOT IN ('buyer_manual', 'buyer_uploaded', 'buyer_excel', 'historical_purchase_dump'))
    AND json_extract(raw,'$.buyerId') IS NULL
    AND json_extract(raw,'$.buyerAccountId') IS NULL;
