CREATE INDEX IF NOT EXISTS idx_user_role_created
  ON "user" (role_uuid, created_ts DESC, uuid DESC);
