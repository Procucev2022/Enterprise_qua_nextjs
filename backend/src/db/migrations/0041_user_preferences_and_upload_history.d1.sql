-- =============================================================================
-- Migration 0041 (D1): User preferences & vendor upload history
-- =============================================================================
-- Moves per-user UI preferences (theme, table column visibility/order) and
-- vendor upload batch history out of browser localStorage into persistent
-- database storage so every browser and device renders consistent state.

CREATE TABLE IF NOT EXISTS user_preferences (
  user_key TEXT NOT NULL,
  pref_key TEXT NOT NULL,
  pref_value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_key, pref_key)
);
CREATE INDEX IF NOT EXISTS idx_user_preferences_user ON user_preferences (user_key);

CREATE TABLE IF NOT EXISTS vendor_upload_history (
  id TEXT PRIMARY KEY,
  owner_key TEXT NOT NULL,
  buyer_id TEXT,
  buyer_email TEXT,
  role TEXT NOT NULL DEFAULT 'buyer',
  file_name TEXT NOT NULL,
  total_count INTEGER NOT NULL DEFAULT 0,
  imported_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  onboarding_failed_count INTEGER NOT NULL DEFAULT 0,
  onboarding_skipped_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'COMPLETED',
  records_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_vendor_upload_history_owner ON vendor_upload_history (owner_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vendor_upload_history_buyer ON vendor_upload_history (buyer_id, created_at DESC);
