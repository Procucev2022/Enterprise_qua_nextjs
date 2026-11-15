-- 0028_drop_system_error_logs.pg.sql
-- Drop system_error_logs table and associated indexes.
-- Application logs are persisted to local filesystem in development and Cloudflare Observability in production.

DROP INDEX IF EXISTS idx_sys_error_level;
DROP INDEX IF EXISTS idx_sys_error_category;
DROP TABLE IF EXISTS system_error_logs;

