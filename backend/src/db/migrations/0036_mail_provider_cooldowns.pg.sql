-- =============================================================================
-- Migration 0036 (PostgreSQL): Persistent outbound mail provider cooldowns
-- =============================================================================
-- Shares provider cooldowns (revoked OAuth grants like invalid_grant, rate-limit
-- Retry-After windows) across worker instances and restarts so scheduled tasks
-- and request handlers stop retrying dead credentials on every cold start.

CREATE TABLE IF NOT EXISTS mail_provider_cooldowns (
  provider_key VARCHAR(255) PRIMARY KEY,
  until_ms BIGINT NOT NULL,
  reason TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mail_provider_cooldowns_until ON mail_provider_cooldowns (until_ms);
