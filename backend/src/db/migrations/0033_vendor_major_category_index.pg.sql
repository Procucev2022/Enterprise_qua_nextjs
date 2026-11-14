-- 0033_vendor_major_category_index.pg.sql
--
-- PostgreSQL counterpart of 0033_vendor_major_category_index.d1.sql. The lookup in
-- domainQueries.getPublicVendorsByMajorCategoryFromDB filters on lower(major_category) = ANY($1), which
-- the plain idx_vendors_major_category index cannot serve. This expression index lets PostgreSQL read
-- only the matching vendors.
CREATE INDEX IF NOT EXISTS idx_vendors_major_category_lower ON vendors (lower(major_category));
