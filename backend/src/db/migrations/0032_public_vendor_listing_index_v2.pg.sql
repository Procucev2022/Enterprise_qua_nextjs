-- 0032_public_vendor_listing_index_v2.pg.sql
--
-- PostgreSQL counterpart of 0032_public_vendor_listing_index_v2.d1.sql. The PostgreSQL publicOnly
-- predicate already uses lower(raw->>'buyerId') IS NULL and lower(raw->>'buyerAccountId') IS NULL,
-- which this index matches, so the planner problem that 0032 fixes on D1 does not occur here.
-- This file only restates the 0031 index with IF NOT EXISTS so both migration sets stay in step.
CREATE INDEX IF NOT EXISTS idx_vendors_public_created_at ON vendors (created_at DESC)
  WHERE lower(raw->>'buyerId') IS NULL AND lower(raw->>'buyerAccountId') IS NULL;
