-- 0040_notifications_and_category_indexes.d1.sql
--
-- Covering composite indexes for hot buyer-profile category reads and
-- recipient-scoped notification polling in Cloudflare D1.
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_unread ON notifications (recipient_type, recipient_id, is_read);
CREATE INDEX IF NOT EXISTS idx_org_division_category_user_active ON org_division_category (user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_org_division_category_org_active ON org_division_category (organization_id, is_active);
