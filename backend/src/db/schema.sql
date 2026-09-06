-- ==============================================================================
-- APPLICATION SCHEMA (Neon PostgreSQL) — the single datastore
-- ==============================================================================
-- Neon holds everything: the identity/authentication tables the login module
-- reads, the organisation + procurement-category tables the buyer and category
-- manager modules read and write, and the domain records (vendors, RFQs,
-- evaluations, catalogue, buyer accounts, AI feed, audit logs).
--
-- There is no second database. The MySQL identity pool this backend used to
-- carry alongside Postgres has been removed: authentication now resolves against
-- the `user` table below, and nothing falls back to in-memory seed data when a
-- table is empty — an empty table means no records, which is reported as such.
--
-- Domain tables keep each row's full object verbatim in `raw` (JSONB), which is
-- what storeService.js reads back with zero field-mapping. Identity tables are
-- fully typed instead, because they are queried by column (email lookups, role
-- joins, category filters) rather than loaded wholesale.
-- ==============================================================================

-- ==============================================================================
-- IDENTITY & ACCESS
-- ==============================================================================
-- Application-assigned `uuid` primary keys throughout (no sequences): the rows
-- were migrated from the previously-shared Procucev schema, which assigned them
-- in application code, and existing ids must survive so issued session tokens
-- and every `org_uuid` / `role_uuid` reference stay valid.
--
-- Booleans are real BOOLEANs. The MySQL original used `bit(1)`, which read back
-- as a Buffer and needed a conversion helper on every single row; that helper is
-- gone along with the driver.

CREATE TABLE IF NOT EXISTS role (
  uuid VARCHAR(64) PRIMARY KEY,
  role_name VARCHAR(255) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_ts TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Role lookups are by name (resolveMasterUuid), never by uuid.
CREATE INDEX IF NOT EXISTS idx_role_role_name ON role (role_name);

CREATE TABLE IF NOT EXISTS org_types (
  uuid VARCHAR(64) PRIMARY KEY,
  type_name VARCHAR(255) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_ts TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_org_types_type_name ON org_types (type_name);

CREATE TABLE IF NOT EXISTS master_status (
  uuid VARCHAR(64) PRIMARY KEY,
  status VARCHAR(255) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_ts TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_master_status_status ON master_status (status);

-- The buyer organisation. Four fields exist twice — `brand_name`/`refference`,
-- `cin`/`crn`, `annual_turnover`/`others`, `contact_designation`/`sub_category`
-- — because the migrated rows populated whichever column the writing client
-- used. Reads prefer the dedicated column and fall back to the legacy alias;
-- writes set both, so no historical row becomes unreadable.
CREATE TABLE IF NOT EXISTS organization (
  uuid VARCHAR(64) PRIMARY KEY,
  organization_name VARCHAR(512) NOT NULL,
  brand_name VARCHAR(512),
  refference VARCHAR(512),
  type VARCHAR(255),
  pan VARCHAR(64),
  gstin VARCHAR(64),
  cin VARCHAR(64),
  crn VARCHAR(64),
  website VARCHAR(512),
  annual_turnover VARCHAR(255),
  others VARCHAR(255),
  address1 VARCHAR(1024),
  city VARCHAR(255),
  state VARCHAR(255),
  zip_code VARCHAR(32),
  country VARCHAR(255) DEFAULT 'India',
  contact_person VARCHAR(255),
  contact_designation VARCHAR(255),
  sub_category VARCHAR(255),
  email VARCHAR(255),
  organization_phonenumber VARCHAR(32),
  org_type_uuid VARCHAR(64),
  client_status_uuid VARCHAR(64),
  self_client BOOLEAN DEFAULT false,
  source_type VARCHAR(16),
  company_id VARCHAR(64),
  gmt_name VARCHAR(255),
  bfs_name VARCHAR(255),
  is_india BOOLEAN DEFAULT true,
  upgrade_days INTEGER DEFAULT 0,
  rfq_credits INTEGER DEFAULT 0,
  rfq_used_count INTEGER DEFAULT 0,
  quote_submitted INTEGER DEFAULT 0,
  created_by VARCHAR(255),
  created_ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_modified_by VARCHAR(255),
  last_modified_ts TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Registration reuses an existing organisation by (name, type).
CREATE INDEX IF NOT EXISTS idx_organization_name_type ON organization (organization_name, org_type_uuid);

-- The login account. `username` holds the login email; `email` is a separate,
-- non-authoritative contact column.
--
-- Deliberately NOT unique on `username`: the migrated data contains repeated
-- login emails across different organisations, so a unique index would have
-- rejected real rows. Every read therefore resolves a single row explicitly
-- (`order by is_active desc, created_ts desc limit 1`) and registration guards
-- for duplicates in application code.
CREATE TABLE IF NOT EXISTS "user" (
  uuid VARCHAR(64) PRIMARY KEY,
  username VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  password VARCHAR(255),
  full_name VARCHAR(255),
  first_name VARCHAR(255),
  phone VARCHAR(32),
  org_uuid VARCHAR(64),
  role_uuid VARCHAR(64),
  client_status_uuid VARCHAR(64),
  unique_id VARCHAR(64),
  is_active BOOLEAN NOT NULL DEFAULT true,
  self_client BOOLEAN NOT NULL DEFAULT false,
  is_approved BOOLEAN NOT NULL DEFAULT true,
  reset_password BOOLEAN NOT NULL DEFAULT false,
  is_web_app BOOLEAN NOT NULL DEFAULT true,
  is_whats_app BOOLEAN NOT NULL DEFAULT false,
  is_bot BOOLEAN NOT NULL DEFAULT false,
  source_type VARCHAR(16),
  verification_status VARCHAR(64),
  created_by VARCHAR(255),
  created_ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_modified_by VARCHAR(255),
  last_modified_ts TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sign-in resolves by lower(username), optionally narrowed by phone, so the
-- index is expression-based to match the predicate exactly.
CREATE INDEX IF NOT EXISTS idx_user_username_lower ON "user" (lower(username));
CREATE INDEX IF NOT EXISTS idx_user_phone ON "user" (phone);
CREATE INDEX IF NOT EXISTS idx_user_org_uuid ON "user" (org_uuid);
CREATE INDEX IF NOT EXISTS idx_user_role_uuid ON "user" (role_uuid);

-- ==============================================================================
-- PROCUREMENT CATEGORY TAXONOMY
-- ==============================================================================
-- `category_division` is the major ("division") / minor ("category") master that
-- every category picker in the app renders. It replaces the two bundled
-- categories.json fixtures the frontend and the ingestion service each used to
-- import: those were duplicate copies of this table with no mechanism to keep
-- them in step, so a taxonomy change landed in one and not the other.
--
-- Division display order is taken from the data (earliest `created_ts` within
-- each division), which is the order the master was originally loaded and the
-- order buyers have always seen — not alphabetical.
CREATE TABLE IF NOT EXISTS category_division (
  uuid VARCHAR(64) PRIMARY KEY,
  division VARCHAR(255),
  category VARCHAR(255),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_ts TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_category_division_division ON category_division (division);
CREATE INDEX IF NOT EXISTS idx_category_division_created_ts ON category_division (created_ts);

-- One row per minor category a buyer organisation has selected. Carries both
-- `organization_id` and a denormalised `user_id`: the read path scopes by user
-- (attributing the most recent edit) and falls back to organisation scope for
-- rows written before `user_id` was populated. Writes replace the selection
-- organisation-wide, because a procurement scope belongs to the organisation and
-- the RFQ fan-out reads it organisation-scoped.
CREATE TABLE IF NOT EXISTS org_division_category (
  uuid VARCHAR(64) PRIMARY KEY,
  organization_id VARCHAR(64),
  user_id VARCHAR(64),
  division VARCHAR(255),
  category VARCHAR(255),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_ts TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_org_division_category_org ON org_division_category (organization_id);
CREATE INDEX IF NOT EXISTS idx_org_division_category_user ON org_division_category (user_id);

-- ==============================================================================
-- SESSION STATE
-- ==============================================================================
-- Issued OTP codes and revoked session tokens used to live in a module-level Map
-- and Set. That made them per-process: a restart silently invalidated every
-- pending OTP, and with more than one worker a code issued by one process could
-- not be verified by another, while a token revoked on one worker stayed valid on
-- the rest — logout did not actually log the session out. Both now live here.

CREATE TABLE IF NOT EXISTS auth_otp_codes (
  -- `<normalisedPhone>_EMAIL_<lowercased email>`: keying on the pair means a code
  -- issued for one registered mobile cannot be replayed against another.
  otp_key VARCHAR(320) PRIMARY KEY,
  code VARCHAR(16) NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Supports the expiry sweep.
CREATE INDEX IF NOT EXISTS idx_auth_otp_codes_expires_at ON auth_otp_codes (expires_at);

CREATE TABLE IF NOT EXISTS auth_revoked_tokens (
  -- The token's signature segment, not the whole token: it is unique per token
  -- and is what verification already compares, so storing the payload too would
  -- persist the session's claims for no benefit.
  signature VARCHAR(255) PRIMARY KEY,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A revoked entry can be dropped once the token would have expired anyway.
CREATE INDEX IF NOT EXISTS idx_auth_revoked_tokens_expires_at ON auth_revoked_tokens (expires_at);

-- ==============================================================================
-- DOMAIN RECORDS
-- ==============================================================================
-- JSONB-first: a handful of typed columns exist alongside `raw` only where a
-- lookup or uniqueness constraint is actually needed; every other field lives in
-- `raw` alone.

CREATE TABLE IF NOT EXISTS vendors (
  id VARCHAR(64) PRIMARY KEY,
  email VARCHAR(255) UNIQUE,
  major_category VARCHAR(255),
  status VARCHAR(100),
  source VARCHAR(50),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vendors_email ON vendors (email);
CREATE INDEX IF NOT EXISTS idx_vendors_major_category ON vendors (major_category);

CREATE TABLE IF NOT EXISTS rfqs (
  id VARCHAR(64) PRIMARY KEY,
  rfq_number VARCHAR(100) UNIQUE,
  category VARCHAR(255),
  status VARCHAR(50),
  sourcing_mode VARCHAR(50),
  budget NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rfqs_rfq_number ON rfqs (rfq_number);
CREATE INDEX IF NOT EXISTS idx_rfqs_status ON rfqs (status);
CREATE INDEX IF NOT EXISTS idx_rfqs_sourcing_mode ON rfqs (sourcing_mode);

CREATE TABLE IF NOT EXISTS evaluations (
  id VARCHAR(64) PRIMARY KEY,
  vendor_id VARCHAR(64),
  status VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_evaluations_vendor_id ON evaluations (vendor_id);

CREATE TABLE IF NOT EXISTS vendor_catalogue (
  id VARCHAR(64) PRIMARY KEY,
  -- Nullable only because historical rows may predate vendor attribution. Every
  -- product added through addProductToCatalogue supplies one; the three demo
  -- products that used to be hardcoded in storeService's constructor and
  -- deliberately never persisted here are gone.
  vendor_id VARCHAR(64),
  sku VARCHAR(100),
  category VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vendor_catalogue_vendor_id ON vendor_catalogue (vendor_id);

CREATE TABLE IF NOT EXISTS buyer_accounts (
  id VARCHAR(64) PRIMARY KEY,
  corporate_email VARCHAR(255) UNIQUE,
  status VARCHAR(100),
  -- activeBuyerAccount is a pointer into this same table, not a separate
  -- record — exactly one row should carry is_active=true at a time.
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_buyer_accounts_corporate_email ON buyer_accounts (corporate_email);

CREATE TABLE IF NOT EXISTS ai_feed (
  id VARCHAR(64) PRIMARY KEY,
  -- Ordering must be exact insertion order — addAIFeedItem's 100-item cap and
  -- any future reads depend on it. created_at alone risks same-instant ties;
  -- a monotonic sequence guarantees correct ordering regardless.
  sequence BIGSERIAL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_feed_sequence ON ai_feed (sequence);

CREATE TABLE IF NOT EXISTS audit_logs (
  id VARCHAR(64) PRIMARY KEY,
  -- This is a SHA-256 hash chain (auditService.js) — each entry's previousHash
  -- must equal the immediately-prior entry's own hash. Reconstructing exact
  -- insertion order on hydration is load-bearing for tamper-chain verification,
  -- not just cosmetic like it is for vendors/rfqs, hence the same monotonic
  -- sequence approach as ai_feed rather than relying on created_at ordering.
  sequence BIGSERIAL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_sequence ON audit_logs (sequence);

-- In-app notifications. One row per (recipient, event): a vendor is notified
-- when an RFQ is raised in a category they cover; the RFQ's owning buyer is
-- notified when a vendor submits a quote against it. `recipient_type` +
-- `recipient_id` is what the authenticated GET /api/notifications scopes by —
-- recipient_id is a vendors.id for a vendor recipient and a buyer_accounts.id
-- for a buyer recipient (the Neon buyer-account id, NOT the identity-schema
-- organisation id). `sequence` gives a stable newest-first order the same way
-- ai_feed/audit_logs do; created_at alone risks same-instant ties on the fan-out
-- insert that raises one notification per matched vendor.
CREATE TABLE IF NOT EXISTS notifications (
  id VARCHAR(64) PRIMARY KEY,
  recipient_type VARCHAR(16) NOT NULL,
  recipient_id VARCHAR(64) NOT NULL,
  kind VARCHAR(32) NOT NULL,
  rfq_id VARCHAR(64),
  is_read BOOLEAN NOT NULL DEFAULT false,
  sequence BIGSERIAL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications (recipient_type, recipient_id);
CREATE INDEX IF NOT EXISTS idx_notifications_sequence ON notifications (sequence);
