ALTER TABLE payment_dues_communications ADD COLUMN account_name TEXT;
ALTER TABLE payment_dues_communications ADD COLUMN sent_by_user_id TEXT;
ALTER TABLE payment_dues_communications ADD COLUMN sent_by_name TEXT;
ALTER TABLE payment_dues_communications ADD COLUMN status TEXT NOT NULL DEFAULT 'SENT';
ALTER TABLE internal_tasks ADD COLUMN resolved_at TEXT;
ALTER TABLE internal_tasks ADD COLUMN resolved_by_name TEXT;

CREATE TABLE IF NOT EXISTS account_documents (
  id TEXT PRIMARY KEY,
  account_type TEXT NOT NULL,
  account_id TEXT NOT NULL,
  document_name TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size INTEGER DEFAULT 0,
  mime_type TEXT DEFAULT 'application/pdf',
  category TEXT NOT NULL DEFAULT 'Other',
  file_url TEXT NOT NULL,
  description TEXT,
  uploaded_by TEXT DEFAULT 'Category Manager',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_account_documents_account ON account_documents (account_type, account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_account_documents_category ON account_documents (category);
CREATE INDEX IF NOT EXISTS idx_account_documents_active ON account_documents (is_active);

CREATE TABLE IF NOT EXISTS user_login_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  user_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone_number TEXT,
  company_name TEXT NOT NULL,
  user_type TEXT NOT NULL,
  login_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  logout_at TEXT,
  duration_seconds INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  ip_address TEXT,
  user_agent TEXT,
  device_info TEXT,
  location TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_user_login_logs_user_type ON user_login_logs (user_type);
CREATE INDEX IF NOT EXISTS idx_user_login_logs_login_at ON user_login_logs (login_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_login_logs_status ON user_login_logs (status);
CREATE INDEX IF NOT EXISTS idx_user_login_logs_email ON user_login_logs (email);

CREATE TABLE IF NOT EXISTS vendor_directory_sessions (
  id TEXT PRIMARY KEY,
  user_uuid TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'category_manager',
  auth_method TEXT NOT NULL DEFAULT 'EMAIL_OTP',
  login_at TEXT NOT NULL,
  last_activity_at TEXT NOT NULL,
  logout_at TEXT,
  duration_seconds INTEGER DEFAULT 0,
  logout_reason TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_vdir_sessions_user ON vendor_directory_sessions (user_uuid);
CREATE INDEX IF NOT EXISTS idx_vdir_sessions_email ON vendor_directory_sessions (email);
CREATE INDEX IF NOT EXISTS idx_vdir_sessions_status ON vendor_directory_sessions (status);
