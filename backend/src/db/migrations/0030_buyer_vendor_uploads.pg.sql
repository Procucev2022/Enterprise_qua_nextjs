-- 0030_buyer_vendor_uploads.pg.sql
-- Tracks many-to-many buyer-vendor upload relationships without duplicating
-- vendor rows or overwriting earlier buyer associations.

CREATE TABLE IF NOT EXISTS buyer_vendor_uploads (
  id VARCHAR(64) PRIMARY KEY,
  buyer_id VARCHAR(64) NOT NULL,
  vendor_id VARCHAR(64) NOT NULL,
  buyer_name VARCHAR(255),
  buyer_company VARCHAR(512),
  buyer_email VARCHAR(255),
  vendor_name VARCHAR(512),
  vendor_email VARCHAR(255),
  upload_source VARCHAR(64) NOT NULL DEFAULT 'buyer_uploaded',
  status VARCHAR(100) NOT NULL DEFAULT 'ACTIVE',
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (buyer_id, vendor_id)
);

CREATE INDEX IF NOT EXISTS idx_buyer_vendor_uploads_buyer_id
  ON buyer_vendor_uploads (buyer_id, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_buyer_vendor_uploads_vendor_id
  ON buyer_vendor_uploads (vendor_id, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_buyer_vendor_uploads_buyer_lower
  ON buyer_vendor_uploads (lower(buyer_id));
CREATE INDEX IF NOT EXISTS idx_buyer_vendor_uploads_vendor_lower
  ON buyer_vendor_uploads (lower(vendor_id));
