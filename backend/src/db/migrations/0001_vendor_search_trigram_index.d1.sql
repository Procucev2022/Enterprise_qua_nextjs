-- One-time backfill for the D1 vendor trigram search index.
-- The schema creates the virtual table and maintenance triggers first. The
-- migration runner stores this file's checksum only after this statement passes.
INSERT INTO vendors_search_fts(vendors_search_fts)
SELECT 'rebuild'
WHERE NOT EXISTS (
  SELECT 1 FROM schema_migrations
  WHERE version = '0001_vendor_search_trigram_index'
);
