-- 0029_drop_all_remaining_log_tables.d1.sql
-- Drop all remaining log tables: ai_classification_logs, user_login_logs, audit_logs, and audit_chain_state.
-- Application logs stream to console / Cloudflare Observability or persist to local filesystem in dev.

-- 1. AI classification logs
DROP INDEX IF EXISTS idx_ai_classification_logs_session;
DROP INDEX IF EXISTS idx_ai_classification_logs_vendor;
DROP INDEX IF EXISTS idx_ai_classification_logs_status;
DROP TABLE IF EXISTS ai_classification_logs;

-- 2. User login logs
DROP INDEX IF EXISTS idx_user_login_logs_user_type;
DROP INDEX IF EXISTS idx_user_login_logs_login_at;
DROP INDEX IF EXISTS idx_user_login_logs_status;
DROP INDEX IF EXISTS idx_user_login_logs_email;
DROP TABLE IF EXISTS user_login_logs;

-- 3. Audit logs & chain state
DROP INDEX IF EXISTS idx_audit_logs_sequence;
DROP INDEX IF EXISTS idx_audit_logs_created_at;
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS audit_chain_state;

