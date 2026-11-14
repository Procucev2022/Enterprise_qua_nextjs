-- 0034_organization_vendor_master_uploaded.d1.sql
--
-- Records when an organization first stored its vendor master. The buyer initial setup popup opens at
-- sign-in only while this column is NULL. The value is written once and never cleared, so a later
-- re-upload neither moves it nor brings the popup back.
--
-- Organizations that already stored a vendor master are backfilled from their earliest vendor ingestion
-- session that holds vendor master rows. That session's creation time is the closest record of the first
-- upload, and it keeps the popup from returning for buyers who already uploaded.
ALTER TABLE organization ADD COLUMN vendor_master_uploaded_at TEXT;

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
