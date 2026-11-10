CREATE TABLE IF NOT EXISTS client_registration_events (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL REFERENCES "user"(uuid),
  user_email VARCHAR(320),
  action VARCHAR(16) NOT NULL CHECK (action IN ('Accepted', 'Rejected')),
  previous_status VARCHAR(16) NOT NULL,
  new_status VARCHAR(16) NOT NULL,
  actor_id VARCHAR(64),
  actor_name VARCHAR(255) NOT NULL,
  actor_email VARCHAR(320),
  remarks TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_registration_events_user_created
  ON client_registration_events (user_id, created_at DESC);
