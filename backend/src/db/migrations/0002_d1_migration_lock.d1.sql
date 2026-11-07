CREATE TABLE IF NOT EXISTS schema_migration_locks (
  lock_key TEXT PRIMARY KEY,
  owner_token TEXT NOT NULL,
  lease_expires_at INTEGER NOT NULL
);
