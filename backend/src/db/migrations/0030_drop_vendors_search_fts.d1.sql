-- 0030_drop_vendors_search_fts.d1.sql
-- Drop unnecessary FTS virtual table and triggers to eliminate D1 CPU spikes and redundant data.
DROP TRIGGER IF EXISTS vendors_search_fts_insert;
DROP TRIGGER IF EXISTS vendors_search_fts_delete;
DROP TRIGGER IF EXISTS vendors_search_fts_update;
DROP TABLE IF EXISTS vendors_search_fts;

