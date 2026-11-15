CREATE TABLE IF NOT EXISTS management_approvals (
  id VARCHAR(64) PRIMARY KEY,
  request_number VARCHAR(64) NOT NULL UNIQUE,
  module VARCHAR(128) NOT NULL,
  project VARCHAR(255) NOT NULL,
  applicant_name VARCHAR(255) NOT NULL,
  applicant_email VARCHAR(320) NOT NULL,
  value_impact TEXT NOT NULL,
  maker_name VARCHAR(255) NOT NULL,
  maker_role VARCHAR(128) NOT NULL,
  status VARCHAR(16) NOT NULL CHECK (status IN ('Pending', 'Approved', 'Rejected')),
  details TEXT NOT NULL,
  approver_id VARCHAR(64),
  approver_name VARCHAR(255),
  approver_email VARCHAR(320),
  approver_remarks TEXT,
  last_action_id VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_management_approvals_status_created
  ON management_approvals (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_management_approvals_module_status
  ON management_approvals (module, status);
CREATE INDEX IF NOT EXISTS idx_management_approvals_project
  ON management_approvals (project);

CREATE TABLE IF NOT EXISTS management_approval_events (
  id VARCHAR(64) PRIMARY KEY,
  approval_id VARCHAR(64) NOT NULL REFERENCES management_approvals(id),
  request_number VARCHAR(64) NOT NULL,
  action VARCHAR(16) NOT NULL CHECK (action IN ('Approved', 'Rejected')),
  previous_status VARCHAR(16) NOT NULL,
  new_status VARCHAR(16) NOT NULL,
  actor_id VARCHAR(64),
  actor_name VARCHAR(255) NOT NULL,
  actor_email VARCHAR(320),
  remarks TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_management_approval_events_approval_created
  ON management_approval_events (approval_id, created_at DESC);
