-- ==============================================================================
-- DOMAIN DATABASE SCHEMA (Neon PostgreSQL) — vendors + RFQs
-- ==============================================================================
-- Each row's full object is kept verbatim in `raw` (JSONB), which is what
-- storeService.js's hydrateFromDB() reads back with zero field-mapping. This is
-- deliberate: the previous version of this schema (deleted 2026-09-01, commit
-- b984b10) defined a fixed column per field, and its own query layer referenced
-- columns (e.g. vendors.whatsapp_sla, rfqs.buyer_company) that were never added
-- here — a drift that would have broken on first real write. A handful of typed
-- columns are kept alongside `raw` only where a lookup or uniqueness constraint
-- is actually needed; every other field lives in `raw` alone.
-- ==============================================================================

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

-- ==============================================================================
-- The remaining in-memory-only collections, same JSONB-first pattern.
-- ==============================================================================

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
  -- Nullable: the 3 seeded demo products have no owning vendor and are never
  -- written to this table at all (see migrate.js) — they stay an in-memory-only
  -- fallback, matching getVendorCatalogue()'s own "no vendorId filter" case.
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
