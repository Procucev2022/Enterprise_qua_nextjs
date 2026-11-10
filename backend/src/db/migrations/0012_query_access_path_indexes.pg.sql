-- Keep the lookup paths used by identity registration and buyer category
-- reads available on existing PostgreSQL installations, not only fresh seeds.
CREATE INDEX IF NOT EXISTS idx_organization_name_type
  ON organization (organization_name, org_type_uuid);
CREATE INDEX IF NOT EXISTS idx_user_username_lower_phone
  ON "user" (lower(username), phone);

CREATE INDEX IF NOT EXISTS idx_org_division_category_user_active_order
  ON org_division_category (user_id, is_active, division, category);
CREATE INDEX IF NOT EXISTS idx_org_division_category_org_active_order
  ON org_division_category (organization_id, is_active, division, category);

-- The composite indexes retain both equality lookup prefixes and also provide
-- the sort order used when loading a buyer's selected categories.
DROP INDEX IF EXISTS idx_org_division_category_org;
DROP INDEX IF EXISTS idx_org_division_category_user;
DROP INDEX IF EXISTS idx_user_username_lower;
DROP INDEX IF EXISTS idx_user_phone;
