-- 0044_vendors_paid_subscription_index.d1.sql
--
-- Partial index covering paid vendor lookups in categoryManagerDashboardController
-- and directoryKPIQueries so queries filtering by PAID_VENDOR_SQL_D1 read only
-- subscribed rows (newest first) instead of full-scanning 600k+ vendor records
-- in Cloudflare D1.
-- The WHERE clause must stay term-for-term identical to directoryKPIQueries.PAID_VENDOR_SQL_D1.
CREATE INDEX IF NOT EXISTS idx_vendors_paid_subscriptions_created_at
  ON vendors (created_at DESC)
  WHERE ((json_extract(raw, '$.subscriptionPlan') IS NOT NULL AND lower(json_extract(raw, '$.subscriptionPlan')) NOT IN ('none', 'free', 'free_tier', 'free_trial', 'premium', '')) OR (json_extract(raw, '$.subscribedPlan') IS NOT NULL AND lower(json_extract(raw, '$.subscribedPlan')) NOT IN ('none', 'free', 'free_tier', 'free_trial', 'premium', '')) OR (json_extract(raw, '$.plan') IS NOT NULL AND lower(json_extract(raw, '$.plan')) NOT IN ('none', 'free', 'free_tier', 'free_trial', 'premium', '')) OR json_extract(raw, '$.isSubscribed') = 1 OR json_extract(raw, '$.isSubscribed') = 'true');
