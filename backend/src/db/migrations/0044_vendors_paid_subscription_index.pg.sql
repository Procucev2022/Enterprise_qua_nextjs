-- 0044_vendors_paid_subscription_index.pg.sql
--
-- PostgreSQL counterpart of 0044_vendors_paid_subscription_index.d1.sql.
-- Partial index covering paid vendor lookups in categoryManagerDashboardController
-- and directoryKPIQueries.
-- The WHERE clause must stay term-for-term identical to directoryKPIQueries.PAID_VENDOR_SQL_PG.
CREATE INDEX IF NOT EXISTS idx_vendors_paid_subscriptions_created_at
  ON vendors (created_at DESC)
  WHERE ((raw->>'subscriptionPlan' IS NOT NULL AND lower(raw->>'subscriptionPlan') NOT IN ('none', 'free', 'free_tier', 'free_trial', 'premium', '')) OR (raw->>'subscribedPlan' IS NOT NULL AND lower(raw->>'subscribedPlan') NOT IN ('none', 'free', 'free_tier', 'free_trial', 'premium', '')) OR (raw->>'plan' IS NOT NULL AND lower(raw->>'plan') NOT IN ('none', 'free', 'free_tier', 'free_trial', 'premium', '')) OR raw->>'isSubscribed' = 'true');
