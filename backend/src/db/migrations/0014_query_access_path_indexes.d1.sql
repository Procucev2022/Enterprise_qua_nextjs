-- Match indexes to the actual identity registration, sign-in and buyer
-- category predicates. The username+phone composite also serves username-only
-- lookups through its leftmost lower(username) prefix.
CREATE INDEX IF NOT EXISTS idx_organization_name_type
  ON organization (organization_name, org_type_uuid);
CREATE INDEX IF NOT EXISTS idx_user_username_lower_phone
  ON "user" (lower(username), phone);
CREATE INDEX IF NOT EXISTS idx_org_division_category_user_active_order
  ON org_division_category (user_id, is_active, division, category);
CREATE INDEX IF NOT EXISTS idx_org_division_category_org_active_order
  ON org_division_category (organization_id, is_active, division, category);

-- These baseline indexes miss the runtime predicates or target legacy aliases.
-- Drop them after the replacement indexes are installed to reduce D1 write and
-- storage work. Bootstrap schemas remain immutable; this migration updates
-- both existing and newly provisioned databases.
DROP INDEX IF EXISTS idx_organization_org_type_uuid;
DROP INDEX IF EXISTS idx_organization_gstin;
DROP INDEX IF EXISTS idx_user_username;
DROP INDEX IF EXISTS idx_category_division_name;
DROP INDEX IF EXISTS idx_org_division_category_organization_id;
DROP INDEX IF EXISTS idx_org_division_category_user_id;
DROP INDEX IF EXISTS idx_org_division_category_org;
DROP INDEX IF EXISTS idx_audit_logs_created_at;
