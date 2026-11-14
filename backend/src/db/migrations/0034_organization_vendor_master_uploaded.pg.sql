-- 0034_organization_vendor_master_uploaded.pg.sql
--
-- PostgreSQL counterpart of 0034_organization_vendor_master_uploaded.d1.sql. The column records when an
-- organization first stored its vendor master. It stays NULL until that first upload, and the buyer
-- initial setup popup depends on that. Existing organizations are backfilled from their earliest vendor
-- ingestion session that holds vendor master rows, so the popup does not return for buyers who already
-- uploaded.
ALTER TABLE organization ADD COLUMN IF NOT EXISTS vendor_master_uploaded_at TIMESTAMPTZ;

UPDATE organization
   SET vendor_master_uploaded_at = (
         SELECT MIN(s.created_at)
           FROM vendor_ingestion_sessions s
          WHERE s.organization_id = organization.uuid
            AND s.vendor_master_row_count > 0
       )
 WHERE vendor_master_uploaded_at IS NULL
   AND EXISTS (
         SELECT 1
           FROM vendor_ingestion_sessions s
          WHERE s.organization_id = organization.uuid
            AND s.vendor_master_row_count > 0
       );
