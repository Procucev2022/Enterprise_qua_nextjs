-- Restore the 5 free RFQ credits for vendors created while the default was 0.
--
-- PR #375 (committed 2026-10-31 00:58 IST = 2026-10-30 19:28 UTC) set
-- VENDOR_FREE_CREDITS_LIMIT to 0, so every vendor created after it was stored
-- with raw.freeQuotationCredits = 0. The limit is back to 5; this gives those
-- vendors the 5 they should have had. Vendors created before #375 that show 0
-- genuinely used their credits and are left alone, as are Connect/Select
-- subscribers (their balance comes from the plan quota) and anyone who has
-- already consumed a free credit (freeCreditsUsed > 0).
--
-- Run in Cloudflare dashboard -> D1 -> enterprise-qua-d1 -> Studio, one
-- statement at a time. Updated rows are tagged
-- raw.creditBackfill = 'vendor-credits-2026-11-05' for the undo at the end.

-- 1. Preview: how many vendors will be updated.
SELECT COUNT(*) AS to_update
FROM vendors
WHERE datetime(created_at) >= datetime('2026-10-30 19:00:00')
  AND CAST(json_extract(raw, '$.freeQuotationCredits') AS INTEGER) = 0
  AND COALESCE(json_extract(raw, '$.subscriptionPlan'), '') NOT IN ('connect', 'select')
  AND COALESCE(CAST(json_extract(raw, '$.freeCreditsUsed') AS INTEGER), 0) = 0
  AND json_extract(raw, '$.creditBackfill') IS NULL;

-- 2. Update in batches of 500. Re-run until it reports 0 rows written.
UPDATE vendors
SET raw = json_set(raw,
      '$.freeQuotationCredits', 5,
      '$.freeRfqDownloadCredits', 5,
      '$.creditBackfill', 'vendor-credits-2026-11-05'),
    updated_at = CURRENT_TIMESTAMP
WHERE id IN (
  SELECT id FROM vendors
  WHERE datetime(created_at) >= datetime('2026-10-30 19:00:00')
    AND CAST(json_extract(raw, '$.freeQuotationCredits') AS INTEGER) = 0
    AND COALESCE(json_extract(raw, '$.subscriptionPlan'), '') NOT IN ('connect', 'select')
    AND COALESCE(CAST(json_extract(raw, '$.freeCreditsUsed') AS INTEGER), 0) = 0
    AND json_extract(raw, '$.creditBackfill') IS NULL
  LIMIT 500
);

-- 3. Check: query 1 should now return 0, and this shows what was changed.
SELECT COUNT(*) AS backfilled
FROM vendors
WHERE json_extract(raw, '$.creditBackfill') = 'vendor-credits-2026-11-05';

-- Undo (only if needed): put the backfilled vendors back to 0.
-- UPDATE vendors
-- SET raw = json_remove(json_set(raw, '$.freeQuotationCredits', 0, '$.freeRfqDownloadCredits', 0), '$.creditBackfill'),
--     updated_at = CURRENT_TIMESTAMP
-- WHERE id IN (SELECT id FROM vendors WHERE json_extract(raw, '$.creditBackfill') = 'vendor-credits-2026-11-05' LIMIT 500);
