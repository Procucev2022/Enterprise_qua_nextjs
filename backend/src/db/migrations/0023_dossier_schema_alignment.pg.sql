ALTER TABLE payment_dues_communications
  ADD COLUMN IF NOT EXISTS account_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS sent_by_user_id VARCHAR(64),
  ADD COLUMN IF NOT EXISTS sent_by_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS status VARCHAR(32) NOT NULL DEFAULT 'SENT';
ALTER TABLE internal_tasks
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolved_by_name VARCHAR(255);

CREATE TABLE IF NOT EXISTS account_documents (
  id VARCHAR(64) PRIMARY KEY,
  account_type VARCHAR(32) NOT NULL,
  account_id VARCHAR(64) NOT NULL,
  document_name VARCHAR(255) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  file_size BIGINT DEFAULT 0,
  mime_type VARCHAR(128) DEFAULT 'application/pdf',
  category VARCHAR(100) NOT NULL DEFAULT 'Other',
  file_url TEXT NOT NULL,
  description TEXT,
  uploaded_by VARCHAR(255) DEFAULT 'Category Manager',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_account_documents_account
  ON account_documents (account_type, account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_account_documents_category ON account_documents (category);
CREATE INDEX IF NOT EXISTS idx_account_documents_active ON account_documents (is_active);

CREATE TABLE IF NOT EXISTS user_login_logs (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64),
  user_name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  phone_number VARCHAR(64),
  company_name VARCHAR(255) NOT NULL,
  user_type VARCHAR(32) NOT NULL,
  login_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  logout_at TIMESTAMPTZ,
  duration_seconds INTEGER DEFAULT 0,
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  ip_address VARCHAR(64),
  user_agent TEXT,
  device_info VARCHAR(128),
  location VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_user_login_logs_user_type ON user_login_logs (user_type);
CREATE INDEX IF NOT EXISTS idx_user_login_logs_login_at ON user_login_logs (login_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_login_logs_status ON user_login_logs (status);
CREATE INDEX IF NOT EXISTS idx_user_login_logs_email ON user_login_logs (email);

CREATE TABLE IF NOT EXISTS vendor_directory_sessions (
  id VARCHAR(64) PRIMARY KEY,
  user_uuid VARCHAR(64) NOT NULL,
  email VARCHAR(320) NOT NULL,
  role VARCHAR(64) NOT NULL DEFAULT 'category_manager',
  auth_method VARCHAR(32) NOT NULL DEFAULT 'EMAIL_OTP',
  login_at TIMESTAMPTZ NOT NULL,
  last_activity_at TIMESTAMPTZ NOT NULL,
  logout_at TIMESTAMPTZ,
  duration_seconds INTEGER DEFAULT 0,
  logout_reason TEXT,
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  ip_address VARCHAR(64),
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vdir_sessions_user ON vendor_directory_sessions (user_uuid);
CREATE INDEX IF NOT EXISTS idx_vdir_sessions_email ON vendor_directory_sessions (email);
CREATE INDEX IF NOT EXISTS idx_vdir_sessions_status ON vendor_directory_sessions (status);
