-- =============================================================================
-- Migration 0036 (D1): Persistent outbound mail provider cooldowns
-- =============================================================================
-- Shares provider cooldowns (revoked OAuth grants like invalid_grant, rate-limit
-- Retry-After windows) across ephemeral Cloudflare Worker isolates so cron jobs
-- and request handlers stop retrying dead credentials on every cold start.

CREATE TABLE IF NOT EXISTS mail_provider_cooldowns (
  provider_key TEXT PRIMARY KEY,
  until_ms INTEGER NOT NULL,
  reason TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_mail_provider_cooldowns_until ON mail_provider_cooldowns (until_ms);
