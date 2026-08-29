-- ==============================================================================
-- PROCUCEV ENTERPRISE PROCUREMENT PLATFORM (QUA AI 2.0)
-- PostgreSQL Relational Schema Definition
-- ==============================================================================

-- Enable UUID Extension if needed
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Buyer Accounts Table
CREATE TABLE IF NOT EXISTS buyer_accounts (
  id VARCHAR(64) PRIMARY KEY,
  organization_name VARCHAR(255) NOT NULL,
  corporate_email VARCHAR(255) NOT NULL UNIQUE,
  contact_person VARCHAR(255) NOT NULL,
  contact_phone VARCHAR(50),
  industry_vertical VARCHAR(100),
  account_source VARCHAR(50) DEFAULT 'manual_entry',
  subscription VARCHAR(50) DEFAULT 'free_trial',
  sourcing_mode VARCHAR(50) DEFAULT 'mode_1',
  status VARCHAR(50) DEFAULT 'ACTIVE_VERIFIED',
  gstin VARCHAR(50),
  primary_plant_location VARCHAR(255),
  supported_major_categories JSONB DEFAULT '[]'::jsonb,
  supported_minor_categories JSONB DEFAULT '[]'::jsonb,
  remaining_free_rfqs INTEGER DEFAULT 5,
  total_rfqs_created INTEGER DEFAULT 0,
  total_spend VARCHAR(50) DEFAULT '$0',
  is_verified BOOLEAN DEFAULT true,
  created_date VARCHAR(50),
  sync_timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_buyer_accounts_email ON buyer_accounts(corporate_email);
CREATE INDEX IF NOT EXISTS idx_buyer_accounts_org ON buyer_accounts(organization_name);

-- 2. Vendors Table (Empanelled Roster & Network Partners)
CREATE TABLE IF NOT EXISTS vendors (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  contact_person VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(50),
  major_category VARCHAR(255) NOT NULL,
  minor_categories JSONB DEFAULT '[]'::jsonb,
  location VARCHAR(255),
  rating NUMERIC(3, 2) DEFAULT 4.5,
  score NUMERIC(5, 2) DEFAULT 88.0,
  source VARCHAR(50) DEFAULT 'buyer_manual',
  status VARCHAR(100) DEFAULT 'PREFERRED ENTERPRISE SUPPLIER',
  evaluated BOOLEAN DEFAULT false,
  has_record BOOLEAN DEFAULT false,
  match_reason TEXT,
  proximity VARCHAR(100),
  proximity_match BOOLEAN DEFAULT false,
  
  -- Database Availability & Onboarding Credentials
  is_existing_in_database BOOLEAN DEFAULT false,
  onboarding_email_status VARCHAR(50) DEFAULT 'sent',
  onboarding_email_dispatched_at VARCHAR(100),
  temp_password VARCHAR(100),
  first_login_completed BOOLEAN DEFAULT false,
  reminder_cadence VARCHAR(50) DEFAULT 'every_3_days',
  next_reminder_date VARCHAR(100),
  reminders_sent_count INTEGER DEFAULT 0,
  added_by_buyer_company VARCHAR(255),
  added_by_buyer_name VARCHAR(255),
  profile_completion_status VARCHAR(50) DEFAULT 'pending',

  -- Dual-Stream Category Mapping & Reconciliation (Client-Mapped vs Vendor-Selected)
  client_mapped_categories JSONB DEFAULT '[]'::jsonb,
  vendor_selected_categories JSONB DEFAULT '[]'::jsonb,
  is_category_aligned BOOLEAN DEFAULT true,
  category_mismatch_details JSONB DEFAULT '{}'::jsonb,
  category_match_source VARCHAR(100),

  -- Latest Rating Revision
  latest_rating_revision JSONB,
  rating_revision_history JSONB DEFAULT '[]'::jsonb,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_vendors_email ON vendors(email);
CREATE INDEX IF NOT EXISTS idx_vendors_major_cat ON vendors(major_category);
CREATE INDEX IF NOT EXISTS idx_vendors_source ON vendors(source);

-- 3. RFQs (Request for Quotation) Table
CREATE TABLE IF NOT EXISTS rfqs (
  id VARCHAR(64) PRIMARY KEY,
  rfq_number VARCHAR(100) NOT NULL UNIQUE,
  title VARCHAR(500) NOT NULL,
  category VARCHAR(255) NOT NULL,
  created_at VARCHAR(100),
  deadline VARCHAR(100),
  status VARCHAR(50) DEFAULT 'open',
  line_items_count INTEGER DEFAULT 1,
  total_estimated_value VARCHAR(100),
  sourcing_mode VARCHAR(50) DEFAULT 'mode_1',
  quotes_count INTEGER DEFAULT 0,
  target_savings VARCHAR(50) DEFAULT '12-18%',
  chasing_active BOOLEAN DEFAULT false,
  allocated_time VARCHAR(100),
  elapsed_time VARCHAR(100),
  assigned_vendors JSONB DEFAULT '[]'::jsonb,
  line_items JSONB DEFAULT '[]'::jsonb,
  quotes JSONB DEFAULT '[]'::jsonb,
  follow_up_data JSONB DEFAULT '{}'::jsonb,
  db_created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  db_updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rfqs_number ON rfqs(rfq_number);
CREATE INDEX IF NOT EXISTS idx_rfqs_category ON rfqs(category);
CREATE INDEX IF NOT EXISTS idx_rfqs_status ON rfqs(status);
CREATE INDEX IF NOT EXISTS idx_rfqs_sourcing_mode ON rfqs(sourcing_mode);

-- 4. Vendor 360° Evaluations Table
CREATE TABLE IF NOT EXISTS vendor_evaluations (
  id VARCHAR(64) PRIMARY KEY,
  vendor_id VARCHAR(64) NOT NULL,
  vendor_name VARCHAR(255) NOT NULL,
  contact_person VARCHAR(255),
  email VARCHAR(255),
  phone VARCHAR(50),
  category VARCHAR(255),
  submission_date VARCHAR(100),
  status VARCHAR(100) DEFAULT 'PREFERRED ENTERPRISE SUPPLIER',
  overall_score NUMERIC(5, 2) DEFAULT 88.0,
  system_action TEXT,
  module_scores JSONB DEFAULT '{}'::jsonb,
  documents JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_evaluations_vendor_id ON vendor_evaluations(vendor_id);
CREATE INDEX IF NOT EXISTS idx_evaluations_vendor_name ON vendor_evaluations(vendor_name);

-- 5. Vendor Rating Revisions Table
CREATE TABLE IF NOT EXISTS vendor_rating_revisions (
  id VARCHAR(64) PRIMARY KEY,
  vendor_id VARCHAR(64) NOT NULL,
  vendor_name VARCHAR(255) NOT NULL,
  buyer_company VARCHAR(255) NOT NULL,
  buyer_name VARCHAR(255) NOT NULL,
  buyer_email VARCHAR(255),
  timestamp VARCHAR(100),
  quality_score NUMERIC(5, 2) NOT NULL,
  cost_score NUMERIC(5, 2) NOT NULL,
  delivery_score NUMERIC(5, 2) NOT NULL,
  buyer_average NUMERIC(5, 2) NOT NULL,
  previous_score NUMERIC(5, 2) NOT NULL,
  new_composite_score NUMERIC(5, 2) NOT NULL,
  previous_rating NUMERIC(3, 2) NOT NULL,
  new_rating NUMERIC(3, 2) NOT NULL,
  remarks TEXT NOT NULL,
  email_dispatched BOOLEAN DEFAULT true,
  sha_signature VARCHAR(255) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rating_rev_vendor_id ON vendor_rating_revisions(vendor_id);
CREATE INDEX IF NOT EXISTS idx_rating_rev_buyer_company ON vendor_rating_revisions(buyer_company);

-- 6. Immutable Audit Logs Table
CREATE TABLE IF NOT EXISTS audit_logs (
  id VARCHAR(64) PRIMARY KEY,
  timestamp VARCHAR(100) NOT NULL,
  user_email VARCHAR(255) NOT NULL,
  action TEXT NOT NULL,
  rfq_number VARCHAR(100),
  sha_signature VARCHAR(255) NOT NULL,
  status VARCHAR(50) DEFAULT 'TAMPER_CHECK_OK',
  ip_address VARCHAR(100) DEFAULT '10.0.4.12 (Azure Private VNet)',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_email);
CREATE INDEX IF NOT EXISTS idx_audit_logs_rfq ON audit_logs(rfq_number);

-- 7. Autonomous AI Bot Activity Feed Table
CREATE TABLE IF NOT EXISTS ai_bot_feed (
  id VARCHAR(64) PRIMARY KEY,
  timestamp VARCHAR(100) NOT NULL,
  time_ago VARCHAR(50),
  type VARCHAR(50) NOT NULL,
  channel VARCHAR(50),
  title VARCHAR(500) NOT NULL,
  message TEXT NOT NULL,
  recipient VARCHAR(255),
  rfq_number VARCHAR(100),
  status VARCHAR(50) DEFAULT 'delivered',
  channel_details JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ai_bot_feed_rfq ON ai_bot_feed(rfq_number);
CREATE INDEX IF NOT EXISTS idx_ai_bot_feed_type ON ai_bot_feed(type);

-- 8. System Configuration & Telemetry Table
CREATE TABLE IF NOT EXISTS system_config (
  id VARCHAR(64) PRIMARY KEY,
  key VARCHAR(100) NOT NULL UNIQUE,
  value JSONB NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
