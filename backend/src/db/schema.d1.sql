-- =============================================================================
-- CLOUDFLARE D1 SCHEMA  (SQLite dialect)
-- =============================================================================
-- This is the D1/SQLite equivalent of schema.sql (Postgres).
-- Key differences:
--   • TIMESTAMPTZ  → TEXT  (ISO-8601 stored as string)
--   • JSONB        → TEXT  (JSON stored as string, json_extract() for queries)
--   • BIGSERIAL    → INTEGER PRIMARY KEY AUTOINCREMENT (or rowid alias)
--   • now()        → strftime('%Y-%m-%dT%H:%M:%fZ','now')
--   • BOOLEAN      → INTEGER (0/1)
--   • NUMERIC      → REAL
--   • VARCHAR(n)   → TEXT   (SQLite ignores length constraints)
--   • No pg_trgm / GIN indexes (SQLite has no extension system)
--   • No CREATE EXTENSION
--   • ON CONFLICT … DO UPDATE uses SQLite UPSERT syntax (identical to pg for
--     our use-case — `ON CONFLICT (col) DO UPDATE SET …` — no changes needed)
--   • UNIQUE constraints on NULLable columns: SQLite treats each NULL as
--     distinct, so UNIQUE on a nullable column works correctly.
--
-- Every statement is idempotent (CREATE TABLE IF NOT EXISTS).
-- Never ALTER or DROP — this is applied automatically against the live DB.
-- =============================================================================

-- =============================================================================
-- IDENTITY & ACCESS
-- =============================================================================

CREATE TABLE IF NOT EXISTS role (
  uuid TEXT PRIMARY KEY,
  role_name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_ts TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_role_role_name ON role (role_name);

CREATE TABLE IF NOT EXISTS org_types (
  uuid TEXT PRIMARY KEY,
  type_name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_ts TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_org_types_type_name ON org_types (type_name);

CREATE TABLE IF NOT EXISTS master_status (
  uuid TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_ts TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_master_status_status ON master_status (status);

CREATE TABLE IF NOT EXISTS organization (
  uuid TEXT PRIMARY KEY,
  organization_name TEXT NOT NULL,
  brand_name TEXT,
  refference TEXT,
  type TEXT,
  pan TEXT,
  gstin TEXT,
  cin TEXT,
  crn TEXT,
  website TEXT,
  annual_turnover TEXT,
  others TEXT,
  address1 TEXT,
  city TEXT,
  state TEXT,
  country TEXT,
  pincode TEXT,
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  contact_designation TEXT,
  sub_category TEXT,
  logo_url TEXT,
  org_type_uuid TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_ts TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_modified_ts TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_organization_org_type_uuid ON organization (org_type_uuid);
CREATE INDEX IF NOT EXISTS idx_organization_gstin ON organization (gstin);

CREATE TABLE IF NOT EXISTS "user" (
  uuid TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  password TEXT NOT NULL,
  full_name TEXT,
  organization_name TEXT,
  org_uuid TEXT,
  role_uuid TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  is_password_changed INTEGER NOT NULL DEFAULT 0,
  created_ts TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_modified_ts TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_user_username ON "user" (username);
CREATE INDEX IF NOT EXISTS idx_user_org_uuid ON "user" (org_uuid);
CREATE INDEX IF NOT EXISTS idx_user_role_uuid ON "user" (role_uuid);

CREATE TABLE IF NOT EXISTS category_division (
  uuid TEXT PRIMARY KEY,
  division_name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_ts TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_modified_ts TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_category_division_name ON category_division (division_name);

CREATE TABLE IF NOT EXISTS org_division_category (
  uuid TEXT PRIMARY KEY,
  org_uuid TEXT,
  division_uuid TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_ts TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_modified_ts TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_org_division_category_org ON org_division_category (org_uuid);

CREATE TABLE IF NOT EXISTS auth_otp_codes (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  code TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_auth_otp_codes_email ON auth_otp_codes (email);
CREATE INDEX IF NOT EXISTS idx_auth_otp_codes_expires_at ON auth_otp_codes (expires_at);

CREATE TABLE IF NOT EXISTS auth_revoked_tokens (
  jti TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL,
  revoked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_auth_revoked_tokens_expires_at ON auth_revoked_tokens (expires_at);

-- =============================================================================
-- DOMAIN RECORDS
-- =============================================================================

CREATE TABLE IF NOT EXISTS vendors (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  major_category TEXT,
  status TEXT,
  source TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  raw TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vendors_email ON vendors (email);
CREATE INDEX IF NOT EXISTS idx_vendors_major_category ON vendors (major_category);
CREATE INDEX IF NOT EXISTS idx_vendors_created_at ON vendors (created_at DESC);

CREATE TABLE IF NOT EXISTS rfqs (
  id TEXT PRIMARY KEY,
  rfq_number TEXT UNIQUE,
  category TEXT,
  status TEXT,
  sourcing_mode TEXT,
  budget REAL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  raw TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rfqs_rfq_number ON rfqs (rfq_number);
CREATE INDEX IF NOT EXISTS idx_rfqs_status ON rfqs (status);
CREATE INDEX IF NOT EXISTS idx_rfqs_sourcing_mode ON rfqs (sourcing_mode);
CREATE INDEX IF NOT EXISTS idx_rfqs_created_at ON rfqs (created_at DESC);

CREATE TABLE IF NOT EXISTS evaluations (
  id TEXT PRIMARY KEY,
  vendor_id TEXT,
  status TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  raw TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_evaluations_vendor_id ON evaluations (vendor_id);

CREATE TABLE IF NOT EXISTS vendor_catalogue (
  id TEXT PRIMARY KEY,
  vendor_id TEXT,
  sku TEXT,
  category TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  raw TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vendor_catalogue_vendor_id ON vendor_catalogue (vendor_id);

CREATE TABLE IF NOT EXISTS buyer_accounts (
  id TEXT PRIMARY KEY,
  corporate_email TEXT UNIQUE,
  status TEXT,
  is_active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  raw TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_buyer_accounts_corporate_email ON buyer_accounts (corporate_email);

CREATE TABLE IF NOT EXISTS ai_feed (
  id TEXT PRIMARY KEY,
  sequence INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  raw TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_feed_sequence ON ai_feed (sequence);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  sequence INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  raw TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_sequence ON audit_logs (sequence);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  recipient_type TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  rfq_id TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  sequence INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  raw TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications (recipient_type, recipient_id);
CREATE INDEX IF NOT EXISTS idx_notifications_sequence ON notifications (sequence);

CREATE TABLE IF NOT EXISTS email_ingestion_log (
  message_id TEXT PRIMARY KEY,
  rfq_id TEXT,
  rfq_number TEXT,
  from_address TEXT,
  subject TEXT,
  status TEXT NOT NULL,
  detail TEXT,
  processed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_email_ingestion_log_processed_at ON email_ingestion_log (processed_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_ingestion_log_status ON email_ingestion_log (status);

CREATE TABLE IF NOT EXISTS zoho_oauth_token (
  id TEXT PRIMARY KEY DEFAULT 'default',
  access_token TEXT,
  expiry_time TEXT,
  last_updated TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS payment_links (
  id TEXT PRIMARY KEY,
  zoho_payment_link_id TEXT UNIQUE,
  vendor_id TEXT,
  buyer_account_id TEXT,
  payer_type TEXT NOT NULL DEFAULT 'vendor',
  status TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  raw TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payment_links_vendor_id ON payment_links (vendor_id);
CREATE INDEX IF NOT EXISTS idx_payment_links_buyer_account_id ON payment_links (buyer_account_id);
CREATE INDEX IF NOT EXISTS idx_payment_links_status ON payment_links (status);

-- =============================================================================
-- VENDOR MASTER & PO DATA INGESTION
-- =============================================================================

CREATE TABLE IF NOT EXISTS vendor_ingestion_sessions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  created_by_user_id TEXT,
  created_by_email TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  current_step INTEGER NOT NULL DEFAULT 1,
  horizon_type TEXT,
  horizon_start TEXT,
  horizon_end TEXT,
  vendor_master_file_name TEXT,
  vendor_master_row_count INTEGER NOT NULL DEFAULT 0,
  po_file_name TEXT,
  po_row_count INTEGER NOT NULL DEFAULT 0,
  po_in_horizon_count INTEGER NOT NULL DEFAULT 0,
  po_outside_horizon_count INTEGER NOT NULL DEFAULT 0,
  matched_vendor_count INTEGER NOT NULL DEFAULT 0,
  unmatched_vendor_count INTEGER NOT NULL DEFAULT 0,
  ai_status TEXT NOT NULL DEFAULT 'IDLE',
  ai_processed_count INTEGER NOT NULL DEFAULT 0,
  ai_total_count INTEGER NOT NULL DEFAULT 0,
  ai_failed_count INTEGER NOT NULL DEFAULT 0,
  ai_started_at TEXT,
  ai_completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  raw TEXT
);
CREATE INDEX IF NOT EXISTS idx_vendor_ingestion_sessions_org ON vendor_ingestion_sessions (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vendor_ingestion_sessions_status ON vendor_ingestion_sessions (status);

CREATE TABLE IF NOT EXISTS ingestion_jobs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  job_type TEXT NOT NULL,
  file_name TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  total_records INTEGER NOT NULL DEFAULT 0,
  processed_records INTEGER NOT NULL DEFAULT 0,
  imported_records INTEGER NOT NULL DEFAULT 0,
  skipped_records INTEGER NOT NULL DEFAULT 0,
  failed_records INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  error_details TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_session ON ingestion_jobs (session_id, job_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_org ON ingestion_jobs (organization_id, status);

CREATE TABLE IF NOT EXISTS vendor_master_records (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  source_row_number INTEGER,
  vendor_code TEXT,
  company_name TEXT NOT NULL,
  normalized_name TEXT,
  contact_person TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  gstin TEXT,
  rating REAL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  raw TEXT,
  CONSTRAINT uq_vendor_master_session_code UNIQUE (session_id, vendor_code)
);
CREATE INDEX IF NOT EXISTS idx_vendor_master_records_session ON vendor_master_records (session_id);
CREATE INDEX IF NOT EXISTS idx_vendor_master_records_org ON vendor_master_records (organization_id);
CREATE INDEX IF NOT EXISTS idx_vendor_master_records_code ON vendor_master_records (organization_id, vendor_code);
CREATE INDEX IF NOT EXISTS idx_vendor_master_records_gstin ON vendor_master_records (organization_id, gstin);
CREATE INDEX IF NOT EXISTS idx_vendor_master_records_norm_name ON vendor_master_records (organization_id, normalized_name);

CREATE TABLE IF NOT EXISTS po_line_items (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  source_row_number INTEGER,
  po_number TEXT,
  po_date TEXT,
  vendor_code TEXT,
  vendor_name TEXT,
  normalized_vendor_name TEXT,
  vendor_gstin TEXT,
  item_description TEXT,
  specification TEXT,
  quantity REAL,
  uom TEXT,
  spend REAL,
  currency TEXT,
  department TEXT,
  material_code TEXT,
  existing_category TEXT,
  existing_subcategory TEXT,
  in_horizon INTEGER NOT NULL DEFAULT 1,
  matched_vendor_record_id TEXT,
  match_strategy TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  raw TEXT
);
CREATE INDEX IF NOT EXISTS idx_po_line_items_session ON po_line_items (session_id);
CREATE INDEX IF NOT EXISTS idx_po_line_items_org ON po_line_items (organization_id);
CREATE INDEX IF NOT EXISTS idx_po_line_items_horizon ON po_line_items (session_id, in_horizon);
CREATE INDEX IF NOT EXISTS idx_po_line_items_matched ON po_line_items (session_id, matched_vendor_record_id);
CREATE INDEX IF NOT EXISTS idx_po_line_items_vendor_code ON po_line_items (organization_id, vendor_code);

CREATE TABLE IF NOT EXISTS vendor_category_mappings (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  vendor_record_id TEXT NOT NULL,
  vendor_code TEXT,
  company_name TEXT,
  email TEXT,
  vendor_id TEXT,
  ai_major_category TEXT,
  ai_minor_categories TEXT NOT NULL DEFAULT '[]',
  ai_relevant_products TEXT NOT NULL DEFAULT '[]',
  ai_confidence REAL,
  ai_reason TEXT,
  ai_model TEXT,
  buyer_major_category TEXT,
  buyer_minor_categories TEXT NOT NULL DEFAULT '[]',
  source TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
  processing_status TEXT NOT NULL DEFAULT 'QUEUED',
  processing_error TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  po_count INTEGER NOT NULL DEFAULT 0,
  total_spend REAL NOT NULL DEFAULT 0,
  has_po_history INTEGER NOT NULL DEFAULT 0,
  is_new_category_suggestion INTEGER NOT NULL DEFAULT 0,
  suggested_new_category TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  review_action TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  raw TEXT,
  CONSTRAINT uq_vendor_category_mapping UNIQUE (session_id, vendor_record_id)
);
CREATE INDEX IF NOT EXISTS idx_vendor_category_mappings_session ON vendor_category_mappings (session_id);
CREATE INDEX IF NOT EXISTS idx_vendor_category_mappings_org ON vendor_category_mappings (organization_id);
CREATE INDEX IF NOT EXISTS idx_vendor_category_mappings_status ON vendor_category_mappings (session_id, status);
CREATE INDEX IF NOT EXISTS idx_vendor_category_mappings_processing ON vendor_category_mappings (session_id, processing_status);
CREATE INDEX IF NOT EXISTS idx_vendor_category_mappings_major ON vendor_category_mappings (organization_id, buyer_major_category);

CREATE TABLE IF NOT EXISTS vendor_category_dispatches (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  template TEXT NOT NULL,
  major_category TEXT,
  recipient_count INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'QUEUED',
  dispatched_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  raw TEXT
);
CREATE INDEX IF NOT EXISTS idx_vendor_category_dispatches_session ON vendor_category_dispatches (session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vendor_category_dispatches_org ON vendor_category_dispatches (organization_id);

CREATE TABLE IF NOT EXISTS vendor_email_dispatch_log (
  id TEXT PRIMARY KEY,
  dispatch_id TEXT,
  session_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  vendor_record_id TEXT,
  recipient_email TEXT NOT NULL,
  recipient_name TEXT,
  template TEXT NOT NULL,
  major_category TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'PENDING',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  message_id TEXT,
  detail TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_vendor_email_dispatch_log_session ON vendor_email_dispatch_log (session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vendor_email_dispatch_log_dispatch ON vendor_email_dispatch_log (dispatch_id);
CREATE INDEX IF NOT EXISTS idx_vendor_email_dispatch_log_status ON vendor_email_dispatch_log (session_id, status);
CREATE INDEX IF NOT EXISTS idx_vendor_email_dispatch_log_org ON vendor_email_dispatch_log (organization_id);

CREATE TABLE IF NOT EXISTS vendor_ingestion_audit (
  id TEXT PRIMARY KEY,
  sequence INTEGER,
  session_id TEXT,
  organization_id TEXT NOT NULL,
  user_id TEXT,
  user_email TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  old_value TEXT,
  new_value TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_vendor_ingestion_audit_session ON vendor_ingestion_audit (session_id, sequence DESC);
CREATE INDEX IF NOT EXISTS idx_vendor_ingestion_audit_org ON vendor_ingestion_audit (organization_id, sequence DESC);
CREATE INDEX IF NOT EXISTS idx_vendor_ingestion_audit_action ON vendor_ingestion_audit (action);

CREATE TABLE IF NOT EXISTS ai_classification_logs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  vendor_record_id TEXT,
  vendor_code TEXT,
  model TEXT,
  status TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 1,
  prompt_chars INTEGER,
  po_count INTEGER,
  duration_ms INTEGER,
  error TEXT,
  response TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ai_classification_logs_session ON ai_classification_logs (session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_classification_logs_vendor ON ai_classification_logs (vendor_record_id);
CREATE INDEX IF NOT EXISTS idx_ai_classification_logs_status ON ai_classification_logs (status);

-- =============================================================================
-- CM BULK VENDOR IMPORT
-- =============================================================================

CREATE TABLE IF NOT EXISTS bulk_vendor_import_sessions (
  id TEXT PRIMARY KEY,
  created_by_email TEXT,
  status TEXT NOT NULL DEFAULT 'IN_PROGRESS',
  total_rows_declared INTEGER NOT NULL DEFAULT 0,
  processed_count INTEGER NOT NULL DEFAULT 0,
  imported_count INTEGER NOT NULL DEFAULT 0,
  missing_email_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  invalid_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_bulk_vendor_import_sessions_status ON bulk_vendor_import_sessions (status);

-- =============================================================================
-- CHASER QUEUE (restart-resilient scheduled notifications)
-- =============================================================================
-- One row per chaser dispatch. Workers claim due rows from a Cron Trigger;
-- Node deployments also re-arm pending jobs on boot.
CREATE TABLE IF NOT EXISTS chaser_queue (
  id TEXT PRIMARY KEY,
  rfq_number TEXT NOT NULL,
  rfq_id TEXT NOT NULL,
  vendor_id TEXT NOT NULL,
  vendor_name TEXT NOT NULL,
  vendor_phone TEXT,
  vendor_email TEXT,
  vendor_contact_person TEXT,
  rfq_title TEXT,
  channel TEXT NOT NULL,           -- 'whatsapp' | 'sms' | 'email'
  status TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'processing' | 'fired' | 'failed' | 'cancelled'
  fire_at TEXT NOT NULL,           -- ISO-8601 UTC time to fire
  fired_at TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_chaser_queue_status_fire_at ON chaser_queue (status, fire_at);
CREATE INDEX IF NOT EXISTS idx_chaser_queue_rfq_number ON chaser_queue (rfq_number);
