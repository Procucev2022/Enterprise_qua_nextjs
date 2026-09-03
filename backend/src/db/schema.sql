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
