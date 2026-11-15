-- 0031_public_vendor_listing_index.d1.sql
--
-- Store hydration loads the newest 500 platform vendors (getVendorsPageFromDB with
-- publicOnly). That predicate reads json_extract(raw, ...), which no existing index
-- covers, so SQLite walked every vendor row in created_at order. On the test database
-- one hydration query read 1,901,347 rows and took 2 to 5 seconds. Each cold isolate and
-- each cron tick repeated it, and the overlapping reads exceeded D1's per 10 second
-- resource budget ("D1 DB is overloaded").
--
-- This partial index holds only platform vendors, newest first, so the hydration query
-- reads about LIMIT rows. The WHERE clause must stay term for term identical to the
-- publicOnly D1 predicate in domainQueries.js, otherwise SQLite will not use the index.
-- backend/__tests__/publicVendorListingIndex.test.js checks that both texts still match.
CREATE INDEX IF NOT EXISTS idx_vendors_public_created_at ON vendors (created_at DESC)
  WHERE (source IS NULL OR source NOT IN ('buyer_manual', 'buyer_uploaded', 'buyer_excel', 'historical_purchase_dump'))
    AND lower(json_extract(raw,'$.buyerId')) IS NULL
    AND lower(json_extract(raw,'$.buyerAccountId')) IS NULL;
