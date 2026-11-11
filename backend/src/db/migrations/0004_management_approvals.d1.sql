CREATE TABLE IF NOT EXISTS management_approvals (
  id TEXT PRIMARY KEY,
  request_number TEXT NOT NULL UNIQUE,
  module TEXT NOT NULL,
  project TEXT NOT NULL,
  applicant_name TEXT NOT NULL,
  applicant_email TEXT NOT NULL,
  value_impact TEXT NOT NULL,
  maker_name TEXT NOT NULL,
  maker_role TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Pending', 'Approved', 'Rejected')),
  details TEXT NOT NULL,
  approver_id TEXT,
  approver_name TEXT,
  approver_email TEXT,
  approver_remarks TEXT,
  last_action_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_management_approvals_status_created
  ON management_approvals (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_management_approvals_module_status
  ON management_approvals (module, status);
CREATE INDEX IF NOT EXISTS idx_management_approvals_project
  ON management_approvals (project);

CREATE TABLE IF NOT EXISTS management_approval_events (
  id TEXT PRIMARY KEY,
  approval_id TEXT NOT NULL REFERENCES management_approvals(id),
  request_number TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('Approved', 'Rejected')),
  previous_status TEXT NOT NULL,
  new_status TEXT NOT NULL,
  actor_id TEXT,
  actor_name TEXT NOT NULL,
  actor_email TEXT,
  remarks TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_management_approval_events_approval_created
  ON management_approval_events (approval_id, created_at DESC);
