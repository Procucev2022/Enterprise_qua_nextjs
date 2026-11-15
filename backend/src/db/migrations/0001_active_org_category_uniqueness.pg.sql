-- Keep one active row per normalized organization/category selection. Existing
-- duplicate and blank selections are retained as inactive rows for auditability.
UPDATE org_division_category
SET is_active = false
WHERE is_active
  AND (division IS NULL OR trim(division) = '' OR category IS NULL OR trim(category) = '');

WITH ranked AS (
  SELECT uuid,
         row_number() OVER (
           PARTITION BY organization_id, lower(trim(division)), lower(trim(category))
           ORDER BY created_ts ASC NULLS FIRST, uuid ASC
         ) AS duplicate_rank
  FROM org_division_category
  WHERE is_active
    AND organization_id IS NOT NULL
    AND division IS NOT NULL AND trim(division) <> ''
    AND category IS NOT NULL AND trim(category) <> ''
)
UPDATE org_division_category AS category_row
SET is_active = false
FROM ranked
WHERE category_row.uuid = ranked.uuid
  AND ranked.duplicate_rank > 1;

WITH ranked AS (
  SELECT uuid,
         row_number() OVER (
           PARTITION BY user_id, lower(trim(division)), lower(trim(category))
           ORDER BY created_ts ASC NULLS FIRST, uuid ASC
         ) AS duplicate_rank
  FROM org_division_category
  WHERE is_active
    AND organization_id IS NULL
    AND user_id IS NOT NULL
    AND division IS NOT NULL AND trim(division) <> ''
    AND category IS NOT NULL AND trim(category) <> ''
)
UPDATE org_division_category AS category_row
SET is_active = false
FROM ranked
WHERE category_row.uuid = ranked.uuid
  AND ranked.duplicate_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_org_division_category_active_org_unique
  ON org_division_category (organization_id, lower(trim(division)), lower(trim(category)))
  WHERE is_active
    AND organization_id IS NOT NULL
    AND division IS NOT NULL AND trim(division) <> ''
    AND category IS NOT NULL AND trim(category) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_org_division_category_active_user_unique
  ON org_division_category (user_id, lower(trim(division)), lower(trim(category)))
  WHERE is_active
    AND organization_id IS NULL
    AND user_id IS NOT NULL
    AND division IS NOT NULL AND trim(division) <> ''
    AND category IS NOT NULL AND trim(category) <> '';
