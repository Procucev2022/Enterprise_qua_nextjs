CREATE TABLE IF NOT EXISTS client_registration_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(uuid),
  user_email TEXT,
  action TEXT NOT NULL CHECK (action IN ('Accepted', 'Rejected')),
  previous_status TEXT NOT NULL,
  new_status TEXT NOT NULL,
  actor_id TEXT,
  actor_name TEXT NOT NULL,
  actor_email TEXT,
  remarks TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_client_registration_events_user_created
  ON client_registration_events (user_id, created_at DESC);
