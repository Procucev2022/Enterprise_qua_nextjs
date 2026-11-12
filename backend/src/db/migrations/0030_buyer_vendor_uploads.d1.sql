-- 0030_buyer_vendor_uploads.d1.sql
-- Tracks many-to-many buyer-vendor upload relationships without duplicating
-- vendor rows or overwriting earlier buyer associations.

CREATE TABLE IF NOT EXISTS buyer_vendor_uploads (
  id TEXT PRIMARY KEY,
  buyer_id TEXT NOT NULL,
  vendor_id TEXT NOT NULL,
  buyer_name TEXT,
  buyer_company TEXT,
  buyer_email TEXT,
  vendor_name TEXT,
  vendor_email TEXT,
  upload_source TEXT NOT NULL DEFAULT 'buyer_uploaded',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
