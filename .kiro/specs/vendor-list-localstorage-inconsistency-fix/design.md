# Vendor List localStorage Inconsistency Bugfix Design

## Overview

The buyer vendor list is built on the client by merging the server list from `GET /api/bootstrap` with the browser's `procucev_vendor_upload_history` localStorage key (`reconcileBuyerVendorsWithUploadHistory`, `frontend/lib/constants.ts` lines 2333–2484). Any vendor that exists only in one browser's history is added to that browser's list as a synthetic `v-hist-local-*` vendor. Upload paths that never reach the server (CSV/TSV/TXT in `initial-setup-modal.tsx`, start-job failures that fall back to a local "COMPLETED" job) and helpers that mirror edits into localStorage (`setVendorsActiveStateInStorage`, `updateVendorInUploadHistoryStorage`, `removeVendorsFromUploadHistoryInStorage`) make each browser's view different. For the Procucev buyer this produces 29 vendors on PC A and 12 on PC B.

The fix makes the server the only source of business data:

1. Every vendor upload (all file types) is persisted through the backend before it is shown as saved.
2. Upload history moves to a new organisation-scoped table, `vendor_upload_batches`, served by `GET /api/vendors/upload-history`.
3. Vendor list consumers read `buyerVendors` from the store only; the reconcile merge and all localStorage mirror writes are removed.
4. The sessionStorage `procucev_cache_*` keys become a first-paint cache that is always revalidated against the server.
5. A one-time, owner-scoped, idempotent migration sends legacy local history to `POST /api/vendors/upload-history/legacy-import` and deletes each local batch only after the server confirms it.

Authentication keys (`procucev_auth_token`, session keys in `authClient.ts` / `vendorAuthClient.ts`) and UI preferences (theme, column prefs, dismissals, session timer, directory filter state) are left unchanged.

## Glossary

- **Bug_Condition (C)**: A screen derives business data (vendor list, counts, attributes, status, upload history, RFQ supplier choices) from browser storage, or a business write is applied only to browser storage, so the result depends on which browser is used.
- **Property (P)**: The figures and records shown for an account equal a pure function of server data for that account, identical on every browser, and every business write is confirmed by the server before it is shown as saved.
- **Preservation**: Behaviour that does not involve browser-held business data: server-side dedup, ownership filtering, category normalisation, OCR/360° counts, the Excel start-job flow, discard of unconfirmed uploads, auth storage, UI preferences, and bootstrap payload shape and performance.
- **F / F'**: The current (unfixed) code and the fixed code.
- **Legacy local history**: Data under the `procucev_vendor_upload_history` localStorage key written by builds before this fix.
- **`reconcileBuyerVendorsWithUploadHistory`**: Function in `frontend/lib/constants.ts` (line 2333) that merges local history records into `buyerVendors`, adds `v-hist-local-*` vendors, and back-fills GSTIN/vendor code on server vendors.
- **`buyerVendors`**: Store state in `frontend/lib/store.tsx`, filled from `GET /api/bootstrap` (`refreshFromDB`, around line 888) and seeded from `sessionStorage['procucev_cache_vendors']` (line 478).
- **`loadBuyerMasterFallbackVendors`**: Function in `backend/src/controllers/bootstrapController.js` (line 30) that adds `v-master-*` vendors from `vendor_master_records` for the buyer's organisation. It returns nothing while the latest ingestion session is `DRAFT` or `VENDOR_MASTER_STORED`.
- **Owner keys**: `buyerId`, `buyerEmail`, `organizationId` on a history batch, compared with the signed-in buyer's account id, corporate email, and organisation id.
- **`clientBatchId`**: The legacy local batch id (`up-<timestamp>`), used as the server idempotency key during migration.

## Bug Details

### Bug Condition

The bug manifests whenever a screen reads or writes business data through browser storage. `reconcileBuyerVendorsWithUploadHistory` adds local-only records and fills attributes from local records. CSV/TSV/TXT vendor uploads skip `POST /api/vendor-ingestion/:sessionId/start-job` (`initial-setup-modal.tsx` line 1291, `if (sessionId && !isCsvOrText)`), and the parallel `stream-upload` call (line 944) only runs when a `sessionId` already exists, is fire-and-forget, and does not block the local "COMPLETED" job. Every upload path writes history only to localStorage (`initial-setup-modal.tsx` lines 1227–1246 and 1329–1366, `VendorUploadModal.tsx` lines 297–350). Status, edit, and delete actions mirror their results into localStorage (`store.tsx` lines 2375, 2418, 2500, 2696, 2825, 2903; `vendor-summary.tsx` lines 1292, 1353). The store marks bootstrap as loaded when a sessionStorage cache exists, so a stale cache can suppress the server fetch.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input = { account, browserStorage, operation }
         operation ∈ { READ_VENDOR_LIST, READ_VENDOR_COUNTS, READ_VENDOR_ATTRIBUTES,
                       READ_UPLOAD_HISTORY, READ_RFQ_SUPPLIERS, READ_EVALUATION_VENDORS,
                       UPLOAD_VENDOR_FILE, CHANGE_VENDOR_STATUS, EDIT_VENDOR, DELETE_VENDOR,
                       LOAD_WITH_SESSION_CACHE, OTHER_BUSINESS_READ_OR_WRITE }
  OUTPUT: boolean

  localBatches := ownerMatching(browserStorage.localStorage['procucev_vendor_upload_history'], account)
                  ∪ ownerless(browserStorage.localStorage['procucev_vendor_upload_history'])

  RETURN
       (operation IN { READ_VENDOR_LIST, READ_VENDOR_COUNTS, READ_RFQ_SUPPLIERS,
                       READ_EVALUATION_VENDORS }
        AND EXISTS rec IN records(localBatches) : NOT matchesServerVendor(rec, serverVendors(account)))
    OR (operation = READ_VENDOR_ATTRIBUTES
        AND EXISTS rec IN records(localBatches), v IN serverVendors(account) :
            matches(rec, v) AND (isEmpty(v.gstin) OR isEmpty(v.vendorCode))
            AND (notEmpty(rec.gstin) OR notEmpty(rec.vendorCode)))
    OR (operation = READ_UPLOAD_HISTORY)                         -- history exists only locally today
    OR (operation = UPLOAD_VENDOR_FILE
        AND (fileType(input) IN { csv, tsv, txt } OR serverStartJobFailed(input)
             OR sessionId(input) IS NULL))
    OR (operation IN { CHANGE_VENDOR_STATUS, EDIT_VENDOR, DELETE_VENDOR }
        AND targetsLocalHistoryRecord(input))
    OR (operation = LOAD_WITH_SESSION_CACHE
        AND sessionCache.vendors ≠ serverVendors(account))
    OR (operation = OTHER_BUSINESS_READ_OR_WRITE
        AND usesBrowserStorageAsSourceOfTruth(input))
END FUNCTION
```

### Examples

- **Vendor summary totals**: Procucev buyer, PC A holds local batches with 17 records that do not match server vendors. Expected: both PCs show the same server figures (12 before the migration runs; 29 on both once PC A's 17 records have been migrated). Actual: PC A shows 29, PC B shows 12.
- **CSV upload**: Buyer uploads `vendors.csv` with 10 rows in initial setup. Expected: rows sent to `start-job`, job status from the server, vendors visible on any PC once the session reaches the stage where bootstrap shows them. Actual: start-job is skipped, a local job is marked `COMPLETED`, 10 records go to localStorage only.
- **GSTIN back-fill**: Server vendor "Acme Steel" has no GSTIN; PC A's local record has `29ABCDE1234F1Z5`. Expected: GSTIN blank on every PC until it is saved on the server. Actual: PC A shows the GSTIN, PC B shows blank.
- **Deactivate**: Buyer deactivates `v-hist-local-up-1712-3` on PC A. Expected: the backend promotes and deactivates it (the controller already handles synthetic ids, `vendorController.js` line 1732), every PC shows INACTIVE. Actual: on failure or for unmatched identifiers, only PC A's local record changes.
- **Manual RFQ**: "Select All" on PC A includes local-only vendors the server does not know. Expected: only server vendors that belong to the buyer.
- **Upload history**: PC B opens "Upload History" and sees "0 Uploads Recorded" while PC A shows 3. Expected: the same 3 server batches on both.
- **Stale cache (edge case)**: Tab opened before another PC deactivated a vendor. Expected: first paint may use the cache, then the bootstrap response replaces it. Actual: `loadedEntitiesRef.current.bootstrap` is `true` when the cache has vendors and evaluations (line 491), so `ensureBootstrapData` returns early.
- **Ownerless legacy batch (edge case)**: A local batch has no `buyerId`, `buyerEmail`, or `organizationId`. Expected: not migrated into the signed-in account and not displayed. Actual: `vendor-summary.tsx` line 420 shows it to any buyer signed in on that browser.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Server vendor dedup by email, vendor code, and name (3.1). The existing dedup in `storeService`/bootstrap stays; the client no longer adds a second merge pass.
- Buyer ownership filtering in `bootstrapController.getBootstrap` and `canBuyerManageVendor` (3.2).
- RFQ and PO summary filtering, including `isRfqOrPoSummaryEntity` (3.3).
- `normalizeVendorCategoryList` and `isPlaceholderVendorCategory` (3.4).
- OCR and 360° evaluated counts derived from server evaluations (3.5).
- Excel/XLS vendor master and PO dump uploads through `start-job`, with the same parsing, `largeFileIngestionService` validation, job polling, and confirmation (3.6).
- Discard of unconfirmed uploads on initial-setup close via `jobs/cancel` with `discardVendorMaster` (3.7). The discarded batch is also hidden from server history.
- Auth token and session storage in `authClient.ts`, `vendorAuthClient.ts`, and the `Header.tsx` session timer keys (3.8, 3.9).
- UI preference keys: `procucev_theme`, column prefs in LoginLogs, Scorecard, Registrations, DocumentVault, Approvals, Tickets, PaymentDues, internal tasks, buyer console, buyers and sellers directories, `buyer_directory_state`, and the profile-completion dismissal (3.9).
- A browser that never had local history shows the same vendors as today (3.10).
- `GET /api/bootstrap` keeps its single request and payload shape (3.11). Upload history is a separate lazy request made when the history modal opens or after an upload, so bootstrap payload size does not grow.
- Upload history shows only the current organisation's uploads, with file name, upload time, and record counts (3.12).

**Scope:**
All inputs that do NOT involve browser-held business data are unaffected. This includes:
- Browsers with no `procucev_vendor_upload_history` key
- Excel uploads whose start-job call succeeds
- Status, edit, and delete calls on persisted vendors (server path unchanged; only the extra localStorage write is removed)
- Auth, theme, column-preference, and session-timer reads and writes
- Category manager and admin views of the bootstrap payload

### Storage Audit Results

The audit covered every `localStorage`/`sessionStorage` call in `frontend/app`, `frontend/lib`, and `frontend/components`.

| Location | Keys | Classification | Action |
|---|---|---|---|
| `lib/constants.ts` history helpers, `initial-setup-modal.tsx`, `VendorUploadModal.tsx`, `vendor-summary.tsx` | `procucev_vendor_upload_history` | Business data | Remove; replace with server history and migration |
| `lib/store.tsx` lines 452–475 | `procucev_cache_{vendors,evaluations,rfqs,activeBuyerAccount,aiFeed,taxonomy}` (sessionStorage) | Performance cache | Keep for first paint; always revalidate; never mark entity as loaded from cache |
| `components/LoginLogsDashboard.tsx` lines 59, 399, 408 | `LOGIN_LOGS_COL_PREF_KEY` | UI preference | None |
| `components/ScorecardDashboard.tsx` lines 98, 1100, 1106 | `SCORECARD_COL_PREF_KEY` | UI preference | None |
| `components/RegistrationsDashboard.tsx` lines 64, 113 | `REGISTRATION_COLUMN_PREF_KEY` | UI preference | None |
| `components/DocumentVaultDashboard.tsx` lines 89, 898, 902 | `DOC_VAULT_COL_PREF_KEY` | UI preference | None |
| `lib/crypto.ts` lines 255–279 | `enc_*` via `encryptStorage`/`decryptStorage` | No callers in application code | None (no business data stored) |
| `ApprovalsDashboard`, `TicketsDashboard`, `PaymentDuesDashboard`, `internal-tasks`, `buyer-console`, `sellers-directory`, `buyers-directory` | Column prefs, `buyer_directory_state` (filters, page, sort) | UI preference | None |
| `lib/store.tsx` lines 636–649 | `procucev_theme` | UI preference | None |
| `components/Header.tsx` | `procucev_session_expires_at`, `procucev_session_role` | Session timer | None |
| `lib/authClient.ts`, `lib/vendorAuthClient.ts`, upload fetch headers | Auth token and session | Auth | None |
| `buyer-profile-completion-modal.tsx` | Session dismissal flag | UI preference | None |

Only the upload-history key and the session cache gating fall under the bug condition. Tasks, approvals, tickets, documents, payment dues, registrations, and scorecards already read from their backend routes.

## Hypothesized Root Cause

1. **Client-side merge of local history into the server list**: `reconcileBuyerVendorsWithUploadHistory` appends unmatched local records as `v-hist-local-*` vendors and fills empty GSTIN/vendor code on matched server vendors. Five consumers call it: `vendor-summary.tsx` (line 1640), `vendor-evaluation-summary.tsx` (line 280), `ingestion-wizard.tsx` (line 346), `ManualRFQModal.tsx` (line 176), and `store.tsx` (lines 2049, 2291).

2. **CSV/text uploads bypass the backend job**: In `initial-setup-modal.tsx`, the vendor master and PO dump handlers guard `start-job` with `!isCsvOrText` (lines 1291, 1748). The `stream-upload` call (lines 944–988 and 1429+) runs only when `sessionId` is set, is not awaited by the save flow, and its failure only shows a toast while the local fallback job still reports `COMPLETED`. When `start-job` throws, the handler also falls back to `localFallbackJob` (line 1322).

3. **Upload history has no server store**: `bulk_vendor_import_sessions` stores counters and `created_by_email` only, without organisation, file name, or records. `ingestion_jobs` stores file name and counts but is not exposed as history. The UI therefore reads history from localStorage only.

4. **Local mirror writes after vendor mutations**: The store and vendor-summary write status, edits, and deletes into local history after the server call. These writes keep local-only vendors alive and make them diverge from the server.

5. **Session cache marks data as loaded**: `loadedEntitiesRef` is initialised with `bootstrap: initialVendors.length > 0 && initialEvaluations.length > 0` (store.tsx line 491), so `ensureBootstrapData(false)` skips the server fetch in a tab that has a cache.

6. **Server-side stage gate (contributing, not a defect)**: `loadBuyerMasterFallbackVendors` returns no `v-master-*` vendors while the latest ingestion session is `DRAFT` or `VENDOR_MASTER_STORED`. On the uploading PC these vendors still appeared through local history, which hid the gate. The gate is consistent across browsers and supports requirement 3.7, so it stays.

## Correctness Properties

Property 1: Bug Condition - Vendor figures and business writes come only from the server

_For any_ account and any browser storage contents where isBugCondition returns true, the fixed application SHALL produce the vendor list, TOTAL/ACTIVE/INACTIVE counts, "Select All (N suppliers)" count, vendor attributes, RFQ supplier options, evaluation-screen vendor lists, and upload history as a function of the server response for that account only, so the result is identical to the result for the same account with empty browser storage; and every vendor upload, status change, edit, or delete SHALL be shown as saved only after the backend confirms it.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10**

Property 2: Preservation - Behaviour without browser-held business data is unchanged

_For any_ input where the bug condition does NOT hold (no legacy local history for the account, Excel uploads whose start-job succeeds, mutations on persisted vendors, auth and UI-preference storage, management-role bootstrap), the fixed code SHALL produce the same result as the original code, preserving server dedup, ownership filtering, RFQ/PO filtering, category normalisation, OCR/360° counts, the Excel ingestion flow, discard of unconfirmed uploads, auth and UI-preference storage, and the bootstrap request shape.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12**

Property 3: Legacy Migration - One-time, owner-scoped, idempotent, lossless

_For any_ legacy local history and any sequence of migration attempts with arbitrary server success, partial failure, or network failure, the fixed migration SHALL (a) send only batches whose owner keys match the signed-in buyer, (b) leave the server with at most one vendor per (organisation, email), (organisation, vendor code), and (organisation, normalised name) and at most one history batch per (organisation, clientBatchId), no matter how many times it runs, (c) remove a local batch only after the server returned a confirmed result for that batch, and (d) leave every unconfirmed or foreign-owner batch in local storage unchanged.

**Validates: Requirements 2.11, 2.12, 2.13, 2.14**

## Fix Implementation

### Changes Required

Assuming the root cause analysis is correct:

#### Backend: schema and migrations

**Files**: `backend/src/db/migrations/0041_vendor_upload_batches.pg.sql`, `backend/src/db/migrations/0041_vendor_upload_batches.d1.sql`, `backend/src/db/schema.sql`, `backend/src/db/schema.d1.sql`

1. **New table `vendor_upload_batches`** (PG shown; D1 uses `TEXT` and `CURRENT_TIMESTAMP`):
   ```sql
   CREATE TABLE IF NOT EXISTS vendor_upload_batches (
     id VARCHAR(64) PRIMARY KEY,
     organization_id VARCHAR(64) NOT NULL,
     buyer_account_id VARCHAR(64),
     created_by_email VARCHAR(320),
     source VARCHAR(32) NOT NULL,          -- BULK_IMPORT | INGESTION_JOB | LEGACY_LOCAL
     status VARCHAR(20) NOT NULL DEFAULT 'COMPLETED', -- PROCESSING | COMPLETED | FAILED | DISCARDED
     client_batch_id VARCHAR(128),
     ingestion_session_id VARCHAR(64),
     bulk_import_session_id VARCHAR(64),
     file_name VARCHAR(512),
     total_records INTEGER NOT NULL DEFAULT 0,
     imported_records INTEGER NOT NULL DEFAULT 0,
     duplicate_records INTEGER NOT NULL DEFAULT 0,
     failed_records INTEGER NOT NULL DEFAULT 0,
     uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     raw JSONB                             -- { records: [...] } capped at 100, same as today's UI
   );
   CREATE UNIQUE INDEX IF NOT EXISTS uq_vendor_upload_batches_org_client
     ON vendor_upload_batches (organization_id, client_batch_id) WHERE client_batch_id IS NOT NULL;
   CREATE INDEX IF NOT EXISTS idx_vendor_upload_batches_org_uploaded
     ON vendor_upload_batches (organization_id, uploaded_at DESC);
   ```
   D1 uses a plain unique index on `(organization_id, client_batch_id)`; SQLite treats NULLs as distinct, so the partial clause is unnecessary. Keep `npm run check:db-schema-parity` passing.

2. **Back up before migrating**: The task list must include a database backup step before `npm run db:migrate` in stage and prod. The migration only adds a table and indexes; it does not modify existing rows.

#### Backend: queries, service, controller, routes

**File**: `backend/src/db/vendorUploadBatchQueries.js` (new)
- `insertBatch`, `upsertBatchByClientId` (`ON CONFLICT (organization_id, client_batch_id) DO NOTHING RETURNING *`, then select the existing row), `incrementBatchCounts`, `appendBatchRecords` (cap 100), `markBatchStatus`, `listBatchesForOrganization(orgId, { limit, offset })` excluding `DISCARDED`. All queries are parameterised and logged with timings through the existing `pool.query` path. Invalidate the query cache for the organisation on every write.

**File**: `backend/src/services/vendorUploadHistoryService.js` (new)
- `resolveOwnerScope(user)`: reuse `storeService.ensureBuyerAccountForUser`, `resolveBuyerOrgIdForScope`, and `buyerScopeIdsFor` so attribution always comes from the authenticated user, never the request body.
- `listHistory(user, paging)`: returns batches in the existing `VendorUploadHistoryBatch` shape (`id`, `fileName`, `uploadedAt`, `timestamp`, `total`, `imported`, `duplicates`, `failed`, `buyerId`, `buyerEmail`, `records`, `status`) so `vendor-summary.tsx` rendering and `handleDownloadBatchCsv` keep working.
- `importLegacyBatch(user, payload)`:
  1. Reject with 403 if any of the payload's `ownerKeys` is present and none matches the caller's scope ids, email, or organisation id (requirement 2.14).
  2. Look up `upsertBatchByClientId(orgId, clientBatchId)`. If the row already exists, return `{ clientBatchId, status: 'ALREADY_IMPORTED', batchId }` without touching vendors.
  3. For each record: skip `FAILED`/`DUPLICATE`/`SKIPPED` statuses and `isRfqOrPoSummaryEntity` rows (same rules as the reconcile function, so nothing that was never displayed becomes a vendor); dedupe within the payload; then match existing organisation vendors by email, vendor code, and normalised name. Matched → `EXISTING` (no write, no attribute overwrite). Email owned by another buyer (global `vendors.email` unique) → `FOREIGN_OWNER` (no claim). Otherwise create through `storeService.empanelIngestedVendor` with buyer attribution, `source: 'buyer_uploaded'`, and `{ allowUnassignedCategory: true }` because legacy records often have no category.
  4. Store all original records (imported or not) with their per-record outcome in the batch `raw.records`, so no legacy record is lost even when it was not turned into a vendor.
  5. Run the batch inside one transaction where the driver supports it (PG); on D1 use the idempotency key so a partial run can be replayed safely.
  6. Return `{ clientBatchId, status: 'IMPORTED', batchId, created, existing, foreignOwner, skipped }`.

**File**: `backend/src/controllers/vendorUploadHistoryController.js` (new)
- `getUploadHistory` and `importLegacyUploadHistory`, each validating input with `validatePayload` and returning structured, descriptive errors (AGENTS.md §16, §17). Log entry, outcome, and counts under category `VENDOR_UPLOAD_HISTORY`, and write an audit entry for each imported batch.

**File**: `backend/src/routes/vendors.js`
- Add, before `router.get('/:id', ...)`:
  - `router.get('/upload-history', authenticate, requireRole('buyer'), vendorUploadHistoryController.getUploadHistory)`
  - `router.post('/upload-history/legacy-import', authenticate, requireRole('buyer'), vendorUploadHistoryController.importLegacyUploadHistory)`
- Apply the existing rate limiter to the legacy-import route.

**File**: `backend/src/controllers/vendorController.js` (`bulkImportVendors`, line 2521)
- Accept optional `fileName` and `clientBatchId` (added to `VALIDATION_SCHEMAS.vendorBulkImportRequest`). For buyers, on the first chunk insert a `vendor_upload_batches` row (`source: 'BULK_IMPORT'`, `status: 'PROCESSING'`, `bulk_import_session_id = sessionId`); on each chunk increment counts and append record summaries; set `COMPLETED` when the bulk session reaches `COMPLETED`. Return `uploadBatchId` in the response. A history write failure is logged at WARN and does not fail the vendor import.

**File**: `backend/src/services/largeFileIngestionService.js` and `backend/src/controllers/vendorIngestionController.js`
- When a `VENDOR_MASTER` job starts, insert a batch row (`source: 'INGESTION_JOB'`, `ingestion_session_id`, file name, `PROCESSING`); update counts and status as the job progresses or completes.
- In `cancelIngestionJob`, when `discardVendorMaster` is true, mark that session's batch rows `DISCARDED` (requirement 3.7).

**Files**: `backend/src/config/validationSchemas.js`, `backend/src/config/constants.js`, `backend/src/config/types.js`
- Schemas: `vendorUploadHistoryQuery` (limit 1–100, offset ≥ 0), `vendorLegacyUploadImportRequest` (`clientBatchId` matching `^up-[0-9]{10,16}$` or a UUID, up to 512-char `fileName`, `uploadedAt` string, `ownerKeys` object, `records` array of 1–`LEGACY_IMPORT_MAX_RECORDS` items, each with string fields capped in length and GSTIN/email/phone validated the same way as `vendorBulkImportRow` but tagged rather than rejected).
- Constants: `VENDOR_UPLOAD_BATCH_SOURCE`, `VENDOR_UPLOAD_BATCH_STATUS`, `LEGACY_IMPORT_MAX_RECORDS = 500`, `LEGACY_IMPORT_RECORD_OUTCOME`, user-facing messages.
- JSDoc typedefs for the batch row and the import result.

#### Frontend: remove local business-data paths

**File**: `frontend/lib/constants.ts`
- Delete `reconcileBuyerVendorsWithUploadHistory`, `setVendorsActiveStateInStorage`, `updateVendorInUploadHistoryStorage`, `removeVendorsFromUploadHistoryInStorage`, `subscribeVendorUploadHistory`, and `matchesUploadHistoryRecord`.
- Keep `VENDOR_UPLOAD_HISTORY_STORAGE_KEY` and `loadVendorUploadHistoryFromStorage` (renamed `readLegacyVendorUploadHistory`) for the migration module only.
- Add `VENDOR_UPLOAD_HISTORY_API`, `LEGACY_HISTORY_MIGRATION` constants (endpoint paths, retry backoff, max attempts per session).

**File**: `frontend/lib/vendorUploadHistoryApi.ts` (new)
- `fetchVendorUploadHistory(paging)` and `importLegacyUploadBatch(payload)`, using the existing authenticated fetch helper and frontend logger.

**File**: `frontend/lib/legacyVendorHistoryMigration.ts` (new)
- `migrateLegacyVendorUploadHistory({ activeBuyerAccount, sessionUser })`:
  1. Read legacy batches; return early if none.
  2. Partition into owner-matching, foreign-owner, and ownerless batches using the owner keys. Only owner-matching batches are sent. Foreign-owner and ownerless batches stay untouched in storage and are never displayed (requirement 2.14). See Open Decision below.
  3. Send owner-matching batches one at a time (`clientBatchId = batch.id`). On `IMPORTED` or `ALREADY_IMPORTED`, remove that batch from local storage using a read-modify-write of the current key value, so a parallel tab's writes are not overwritten. On any error (network, 4xx, 5xx, 401), stop, keep the remaining batches, and schedule a retry on the next sign-in or bootstrap.
  4. When the key holds no remaining batches, remove it.
  5. Guard concurrent runs in one tab with a module-level promise. Cross-tab races are safe because the server deduplicates by `(organization_id, client_batch_id)`.
  6. After at least one batch is imported, call `refreshFromDB()` so the new vendors appear from the server.
  7. Log start, per-batch outcome, and failures through the frontend logger; show a toast with `UI_STRINGS.legacyHistoryMigration.*` on partial failure, with a "Retry Sync" action (AGENTS.md §16).

**File**: `frontend/lib/store.tsx`
- Remove imports and calls of the deleted helpers (lines 66–70, 2049–2055, 2291–2296, 2375, 2418–2430, 2500, 2696, 2825, 2903). `requestVendorEvaluation` and `resolveVendorMutationTarget` resolve vendors from `buyerVendors` only; the backend still accepts `v-master-*` ids from bootstrap.
- Initialise `loadedEntitiesRef` with `bootstrap: false`, `vendors: false`, `evaluations: false`, `rfqs: false` regardless of the session cache, so the first `ensureBootstrapData` always calls the server. The cached arrays may still seed first paint.
- After a successful buyer bootstrap, call `migrateLegacyVendorUploadHistory` once per signed-in user id.
- Expose `vendorUploadHistory`, `isLoadingVendorUploadHistory`, and `refreshVendorUploadHistory()` in the store so all screens share one server-backed list.

**File**: `frontend/app/buyer/vendor-summary.tsx`
- Replace `reconciledBuyerVendors` with `buyerVendors` (line 1640). Remove the `storage`/`vendor_upload_history_updated` listeners (lines 428–440). `loadUploadHistory` calls `refreshVendorUploadHistory()`. Remove the `setVendorsActiveStateInStorage` calls (lines 1292, 1353); success is shown after the server call returns, as today.

**Files**: `frontend/app/buyer/vendor-evaluation-summary.tsx`, `frontend/app/buyer/ingestion-wizard.tsx`, `frontend/app/buyer/ManualRFQModal.tsx`
- Replace the reconcile memo with `buyerVendors` and remove `subscribeVendorUploadHistory`/`loadVendorUploadHistoryFromStorage` usage. RFQ supplier options and "Select All" count come from `buyerVendors` filtered by `isVendorActive` and existing ownership rules.

**File**: `frontend/app/buyer/initial-setup-modal.tsx`
- Use one server path for every file type: parse client-side (unchanged), then `POST start-job` with `rows` for CSV/TSV/TXT and Excel alike, for both `VENDOR_MASTER` and `PO_DUMP`. Remove the parallel `stream-upload` calls for these two flows so a file is not ingested twice.
- If no `sessionId` exists, create the session (`POST /api/vendor-ingestion/session`) before `start-job`.
- Remove `localFallbackJob`/`localPoFallbackJob` as a success state. On `start-job` failure, set a `FAILED` job with the server or network error and a retry action; do not set `vendorMasterUploaded` to `true` until the server job is accepted (requirement 2.3).
- Remove all localStorage history writes (lines 1227–1246, 1329–1366) and the local discard filter (lines 813–829). Discard relies on the `jobs/cancel` call, which now also marks the batch `DISCARDED`.

**File**: `frontend/app/category-manager/VendorUploadModal.tsx`
- Remove `HISTORY_STORAGE_KEY` and local history reads/writes (lines 72, 97–104, 297–350). Send `fileName` and `clientBatchId` with the first `bulkImportVendorRows` chunk. Read history from the store's `vendorUploadHistory`.

**Files**: `frontend/lib/types.ts`, `frontend/lib/validationSchemas.ts`, `frontend/lib/uiStrings.ts`
- Extend `VendorUploadHistoryBatch` with `status`, `source`, `total`, `imported`, `duplicates`, `failed`, `timestamp`. Add `LegacyUploadImportRequest`, `LegacyUploadImportResult`, `LegacyMigrationOutcome`.
- Mirror the legacy-import request schema for client-side pre-checks.
- Add `UI_STRINGS.vendorUploadHistory.*` (loading, empty, load error with retry) and `UI_STRINGS.legacyHistoryMigration.*` (in progress, completed with counts, partial failure with retry, session expired).

### Open Decision (Resolved)

Ownerless legacy batches (no `buyerId`, `buyerEmail`, or `organizationId`) cannot be attributed safely, because several buyers may have signed in on the same browser.

**Decision (confirmed by the user):** Ownerless legacy batches are left in browser storage untouched. They are NOT migrated, NOT displayed, and NOT included in any vendor count or upload-history view. The migration only logs how many ownerless batches were skipped (frontend logger, category `LEGACY_HISTORY_MIGRATION`, with the skipped batch count and no record contents). No confirmation prompt is shown and no "migrate into this account" option is offered. The migration also does not remove the storage key while ownerless or foreign-owner batches remain in it.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior. Tests follow AGENTS.md and `.agents/rules/unit-testing.md`: tests live in `frontend/__tests__/` and `backend/__tests__/`, every touched or new file reaches ≥ 90% statements, branches, functions, and lines, each test finishes within the 20 s global timeout, and frontend assertions use `UI_STRINGS` constants. Property-based tests use `fast-check`, added as a devDependency in `frontend/` and `backend/` (it is not installed today).

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Render the affected components with a mocked store `buyerVendors` list and two storage states (empty vs. seeded local history), and compare the displayed figures. Drive `initial-setup-modal.tsx` with CSV and Excel files and mocked `fetch` to record which endpoints are called. Run on the UNFIXED code.

**Test Cases**:
1. **Two-browser vendor count**: Same server list of 12, local history with 17 unmatched records; assert TOTAL VENDOR equals 12 in both renders (will fail on unfixed code: 29 vs 12).
2. **CSV upload reaches start-job**: Upload `vendors.csv` with a `sessionId`; assert `POST /start-job` is called with the parsed rows (will fail on unfixed code).
3. **No local history writes**: After a CSV upload, assert `localStorage.getItem('procucev_vendor_upload_history')` is null (will fail on unfixed code).
4. **GSTIN back-fill**: Server vendor without GSTIN plus a matching local record with GSTIN; assert the rendered GSTIN is blank (will fail on unfixed code).
5. **Manual RFQ "Select All"**: Assert the count equals the active server vendors (will fail on unfixed code).
6. **Stale session cache**: Seed `procucev_cache_vendors` and `procucev_cache_evaluations`; assert `ensureBootstrapData()` calls `/api/bootstrap` (will fail on unfixed code).
7. **Start-job failure**: Make `start-job` reject; assert the job state is `FAILED` and `vendorMasterUploaded` stays false (may fail on unfixed code).

**Expected Counterexamples**:
- Counts and supplier lists differ between the empty and seeded storage renders.
- No network call for CSV uploads; history present only in localStorage.
- Possible causes: client-side reconcile merge, `!isCsvOrText` guard, local fallback job treated as success, cache-gated bootstrap.

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FOR ALL (serverVendors, localHistory, operation) WHERE isBugCondition(input) DO
  resultSeeded := render_fixed(serverVendors, storage = localHistory, operation)
  resultEmpty  := render_fixed(serverVendors, storage = EMPTY, operation)
  ASSERT resultSeeded.figures = resultEmpty.figures
  ASSERT resultSeeded.figures = deriveFromServer(serverVendors)
  ASSERT no business key written to browser storage during operation
  IF operation IS A WRITE THEN ASSERT shownAsSaved ⇒ serverConfirmed
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT originalFunction(input) = fixedFunction(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for empty-storage renders, Excel uploads, persisted-vendor mutations, and auth/UI-preference storage, then write property-based tests capturing that behavior.

**Test Cases**:
1. **Empty-storage vendor list**: Observe that with no local history the reconcile function returns a copy of `buyerVendors` (constants.ts line 2343); assert the fixed screens show the same list, counts, and order for generated vendor lists.
2. **Excel start-job flow**: Observe the `start-job` request body and job polling for `.xlsx`; assert the fixed code sends the same body and handles the same responses.
3. **Persisted-vendor mutations**: Observe the server calls for status, edit, and delete on non-synthetic ids; assert identical calls and identical resulting `buyerVendors` after the fix.
4. **Dedup, ownership, category, RFQ/PO filters**: Assert `canBuyerManageVendor`, `normalizeVendorCategoryList`, `isRfqOrPoSummaryEntity`, and bootstrap ownership filtering return the same results for generated inputs.
5. **Auth and UI-preference storage**: Assert theme, column prefs, session timer, and auth keys are read and written exactly as before.
6. **Discard on close**: Assert `jobs/cancel` is still sent with `discardVendorMaster: true` for an unconfirmed upload, and the discarded batch does not appear in `GET /api/vendors/upload-history`.

### Unit Tests

- Backend `vendorUploadBatchQueries`: insert, idempotent upsert by `(organization_id, client_batch_id)`, count increments, record cap at 100, organisation-scoped listing excluding `DISCARDED`, PG and D1 SQL variants.
- Backend `vendorUploadHistoryService`: owner check (match, foreign → 403, absent), `ALREADY_IMPORTED`, record outcomes `CREATED`/`EXISTING`/`FOREIGN_OWNER`/`SKIPPED`, uncategorised legacy records, RFQ/PO summary rows skipped, all records stored in `raw`.
- Backend controller and routes: validation errors with field details, 401/403 for non-buyers, route ordering before `/:id`, bulk-import history side effects and WARN on history failure, cancel marks `DISCARDED`, migration file parity (`migrate.test.js`, `check:db-schema-parity`).
- Frontend `legacyVendorHistoryMigration`: owner partitioning, per-batch removal only after confirmation, stop-and-keep on error, 401 handling, concurrent-call guard, key removal when empty, refresh after import.
- Frontend `vendorUploadHistoryApi`, store history state, and session cache revalidation.
- Frontend components: `vendor-summary`, `vendor-evaluation-summary`, `ingestion-wizard`, `ManualRFQModal`, `initial-setup-modal` (CSV and Excel both call `start-job`; failure shows `FAILED` with `UI_STRINGS` text), `VendorUploadModal` (sends `fileName`/`clientBatchId`, no localStorage writes).
- Update `frontend/__tests__/lib/constants.test.ts` to remove tests for deleted helpers and keep coverage ≥ 90%.

### Property-Based Tests

- **Property 1 (fix)**: Generate server vendor lists and arbitrary local history (matching, non-matching, ownerless, foreign-owner, malformed JSON); assert every consumer's figures equal those derived from the server list alone.
- **Property 2 (preservation)**: Generate vendor lists with duplicate emails, codes, names, mixed categories, and active/inactive states with empty storage; assert fixed and original outputs match.
- **Property 3 (migration)**: Generate legacy histories and sequences of server responses (success, already-imported, 4xx, 5xx, network error, 401) across repeated runs; assert no duplicate vendors or batches per organisation, local batches removed only after confirmation, foreign/ownerless batches untouched, and the union of server-stored records and remaining local records equals the original record set.

### Integration Tests

- Backend HTTP (supertest, as in `vendorIngestionHttp.test.js`): buyer uploads through bulk-import and start-job, then `GET /api/vendors/upload-history` returns the batches; legacy-import replayed twice yields one batch and no duplicate vendors; a second buyer cannot read or import into the first buyer's organisation.
- Frontend flow: sign in with seeded legacy history → migration runs → bootstrap refresh shows server vendors → local key removed → a second render with empty storage shows the same figures.
- Frontend flow: CSV upload in initial setup → job polled from the server → history visible after `refreshVendorUploadHistory()`; close without confirming → batch hidden and vendors not shown.
