# Implementation Plan

## Overview

The fix makes the server the only source of vendor data and upload history. Work runs in this order: a failing bug-condition test, preservation tests on the unfixed code, the fix (backend table and routes, then frontend), re-runs of both tests, a backed-up migration on stage and prod, and a final test checkpoint.

Conventions for every task (AGENTS.md, `.agents/rules/unit-testing.md`):
- Tests live in `frontend/__tests__/` or `backend/__tests__/`, mirroring the source path.
- Every new or touched application file must reach >= 90% statements, branches, functions, and lines.
- Each test must finish within the 20,000 ms global timeout. Frontend assertions use `UI_STRINGS` constants, not hardcoded copy.
- Constants go in `constants.ts`/`constants.js`, schemas in `validationSchemas.*`, types in `types.ts`/`types.js`, user-facing text in `uiStrings.ts`.
- Use non-watch test commands only. For a targeted run: `npm test --prefix frontend -- --coverage --collectCoverageFrom="<file>" --coverageThreshold="{}" <test file>` (backend: same with `--prefix backend`).

## Tasks

- [ ] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Local-only vendors inflate vendor figures and business writes bypass the server
  - **Setup (do first)**: add `fast-check` as a devDependency, since it is not installed today:
    - `npm install --save-dev fast-check --prefix frontend`
    - `npm install --save-dev fast-check --prefix backend`
    - Commit the updated `package.json` and `package-lock.json` in both projects
  - **CRITICAL**: This test MUST FAIL on unfixed code. The failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior. It will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples showing that local-only vendors in `procucev_vendor_upload_history` inflate TOTAL VENDOR / ACTIVE / "Select All (N suppliers)"
  - **Scoped PBT Approach**: the bug is deterministic, so scope the main property to the concrete failing case first (12 server vendors for the Procucev buyer, 17 owner-matching local records that match no server vendor), then generalise with `fast-check`
  - Create `frontend/__tests__/app/buyer/vendorListLocalStorage.bugCondition.test.tsx`
  - Bug condition from design (`isBugCondition`): `operation ∈ {READ_VENDOR_LIST, READ_VENDOR_COUNTS, READ_RFQ_SUPPLIERS, READ_EVALUATION_VENDORS}` AND some owner-matching or ownerless local record has no matching server vendor; also `READ_VENDOR_ATTRIBUTES` back-fill, `UPLOAD_VENDOR_FILE` with csv/tsv/txt, and `LOAD_WITH_SESSION_CACHE`
  - Expected behavior (Property 1 in design): figures rendered with seeded storage equal figures rendered with empty storage, and both equal values derived from the mocked server `buyerVendors` only
  - Property cases (fast-check generators: server vendor lists; local batches with owner keys matching the signed-in buyer and records whose email, vendor code, and name match no server vendor):
    - `vendor-summary.tsx`: TOTAL VENDOR, ACTIVE, INACTIVE, and "Select All (N suppliers)" equal the server-derived counts (concrete case: expect 12, unfixed shows 29)
    - `ManualRFQModal.tsx`: "Select All" count equals the number of active server vendors
    - `vendor-evaluation-summary.tsx` and `ingestion-wizard.tsx`: vendor list length equals the server list length
    - GSTIN back-fill: server vendor without GSTIN plus a matching local record with `29ABCDE1234F1Z5`; assert rendered GSTIN is blank
  - Example cases in the same file:
    - `initial-setup-modal.tsx` CSV upload with a `sessionId`: assert `POST /api/vendor-ingestion/:sessionId/start-job` is called with the parsed rows, and `localStorage.getItem('procucev_vendor_upload_history')` stays null
    - `initial-setup-modal.tsx` start-job rejection: assert job state is `FAILED` and `vendorMasterUploaded` stays false
    - `store.tsx` stale cache: seed `sessionStorage` `procucev_cache_vendors` and `procucev_cache_evaluations`, call `ensureBootstrapData()`, assert `/api/bootstrap` is fetched
  - Run on UNFIXED code: `npm test --prefix frontend -- --coverageThreshold="{}" __tests__/app/buyer/vendorListLocalStorage.bugCondition.test.tsx`
  - **EXPECTED OUTCOME**: Test FAILS (this is correct, it proves the bug exists)
  - Document the counterexamples fast-check reports (for example "12 server vendors + 17 unmatched local records renders TOTAL VENDOR 29, expected 12") in a comment block at the top of the test file, and note whether they confirm root causes 1, 2, and 5 in design.md
  - Mark task complete when the test is written, run, and its failure is documented
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.7, 1.8, 1.9, 2.1, 2.2, 2.3, 2.5, 2.7, 2.8, 2.9_

- [ ] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Behaviour without browser-held business data is unchanged
  - **IMPORTANT**: Follow observation-first methodology. Run the UNFIXED code with inputs where `isBugCondition` is false, record the actual outputs, then write properties that assert them
  - Observe on unfixed code:
    - With no `procucev_vendor_upload_history` key, `reconcileBuyerVendorsWithUploadHistory` returns a copy of `buyerVendors` (`frontend/lib/constants.ts` around line 2343), so screens show server vendors in server order
    - `.xlsx` vendor master and PO dump uploads send a specific `start-job` request body and poll job status
    - Status, edit, and delete on persisted (non-synthetic) vendor ids call the same backend endpoints with the same bodies
    - Closing initial setup with an unconfirmed upload sends `jobs/cancel` with `discardVendorMaster: true`
    - `/api/bootstrap` is a single request with an unchanged payload shape
    - Auth keys (`procucev_auth_token`, `authClient.ts`, `vendorAuthClient.ts`), `procucev_theme`, column-preference keys, `buyer_directory_state`, and `procucev_session_expires_at` / `procucev_session_role` are read and written as listed in the design's Storage Audit table
  - Create `frontend/__tests__/app/buyer/vendorListLocalStorage.preservation.test.tsx` with fast-check properties:
    - For generated vendor lists (duplicate emails, codes, names; mixed and placeholder categories; active and inactive) with EMPTY storage, `vendor-summary`, `ManualRFQModal`, `vendor-evaluation-summary`, and `ingestion-wizard` render the same list, counts, and order as observed. Assert against rendered output, not against `reconcileBuyerVendorsWithUploadHistory`, because that function is deleted in task 3
    - `normalizeVendorCategoryList`, `isPlaceholderVendorCategory`, and `isRfqOrPoSummaryEntity` return the observed results for generated inputs
    - `.xlsx` start-job body and job polling match the observed calls
    - Persisted-vendor status, edit, and delete calls and the resulting `buyerVendors` match the observed values
    - Discard on close sends `jobs/cancel` with `discardVendorMaster: true`
    - Auth and UI-preference keys are read and written exactly as observed
  - Create `backend/__tests__/vendorListPreservation.pbt.test.js` with fast-check properties:
    - `bootstrapController.getBootstrap` ownership filtering and `canBuyerManageVendor` return the observed results for generated buyers and vendors
    - Server vendor dedup by email, vendor code, and name returns the observed results
    - `loadBuyerMasterFallbackVendors` still returns nothing while the latest session is `DRAFT` or `VENDOR_MASTER_STORED`
  - Run on UNFIXED code:
    - `npm test --prefix frontend -- --coverageThreshold="{}" __tests__/app/buyer/vendorListLocalStorage.preservation.test.tsx`
    - `npm test --prefix backend -- --coverageThreshold="{}" __tests__/vendorListPreservation.pbt.test.js`
  - **EXPECTED OUTCOME**: Tests PASS (this confirms the baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12_

- [ ] 3. Fix for vendor figures and upload history depending on browser localStorage

  - [ ] 3.1 Add DB migration `0041_vendor_upload_batches` (pg + d1 + schema files)
    - Create `backend/src/db/migrations/0041_vendor_upload_batches.pg.sql` with the `vendor_upload_batches` table, the partial unique index `uq_vendor_upload_batches_org_client` on `(organization_id, client_batch_id) WHERE client_batch_id IS NOT NULL`, and `idx_vendor_upload_batches_org_uploaded` on `(organization_id, uploaded_at DESC)`, exactly as in design.md
    - Create `backend/src/db/migrations/0041_vendor_upload_batches.d1.sql` using `TEXT`, `CURRENT_TIMESTAMP`, and a plain unique index on `(organization_id, client_batch_id)`
    - Add the same table and indexes to `backend/src/db/schema.sql` and `backend/src/db/schema.d1.sql`
    - Add the `db:migrate:d1:local:vendor-upload-batches` script to `backend/package.json` following the 0040 pattern, and append it to `db:setup:mock:local`
    - Add `'0041_vendor_upload_batches'` to the expected version list in `backend/__tests__/migrate.test.js` (around line 380) and update `backend/__tests__/migrateD1.test.js` if it lists versions
    - The migration only creates a table and indexes; it must not modify existing rows
    - Local verification only (no shared databases in this task): `npm run db:migrate --prefix backend` against the local database, then `npm run check:db-schema-parity` and `npm run test:db-schema-parity`
    - _Bug_Condition: isBugCondition(input) where operation = READ_UPLOAD_HISTORY (history has no server store, root cause 3)_
    - _Expected_Behavior: upload history stored on the server, scoped to the organisation (Property 1)_
    - _Preservation: existing tables and rows untouched; bootstrap payload unchanged (3.11)_
    - _Requirements: 2.4, 3.11, 3.12_

  - [ ] 3.2 Add backend constants, validation schemas, and types
    - `backend/src/config/constants.js`: `VENDOR_UPLOAD_BATCH_SOURCE` (`BULK_IMPORT`, `INGESTION_JOB`, `LEGACY_LOCAL`), `VENDOR_UPLOAD_BATCH_STATUS` (`PROCESSING`, `COMPLETED`, `FAILED`, `DISCARDED`), `LEGACY_IMPORT_MAX_RECORDS = 500`, `LEGACY_IMPORT_RECORD_OUTCOME` (`CREATED`, `EXISTING`, `FOREIGN_OWNER`, `SKIPPED`), record cap 100, logger category `VENDOR_UPLOAD_HISTORY`, and user-facing error messages
    - `backend/src/config/validationSchemas.js`: `vendorUploadHistoryQuery` (limit 1–100, offset >= 0), `vendorLegacyUploadImportRequest` (`clientBatchId` matching `^up-[0-9]{10,16}$` or a UUID, `fileName` up to 512 chars, `uploadedAt`, `ownerKeys`, `records` 1–`LEGACY_IMPORT_MAX_RECORDS` with length-capped string fields; GSTIN/email/phone tagged, not rejected), and optional `fileName` and `clientBatchId` on `vendorBulkImportRequest`
    - `backend/src/config/types.js`: JSDoc typedefs for the batch row and the legacy import result
    - Extend existing tests for these modules to keep >= 90% coverage
    - _Requirements: 2.4, 2.11, 2.14_

  - [ ] 3.3 Implement `backend/src/db/vendorUploadBatchQueries.js`
    - `insertBatch`, `upsertBatchByClientId` (`ON CONFLICT (organization_id, client_batch_id) DO NOTHING RETURNING *`, then select the existing row), `incrementBatchCounts`, `appendBatchRecords` (cap 100), `markBatchStatus`, `markSessionBatchesDiscarded`, `listBatchesForOrganization(orgId, { limit, offset })` excluding `DISCARDED`, ordered by `uploaded_at DESC`
    - Parameterised SQL only, run through the existing `pool.query` path so timings are logged; invalidate the query cache for the organisation on every write
    - Tests in `backend/__tests__/vendorUploadBatchQueries.test.js`: insert, idempotent upsert, count increments, record cap, organisation-scoped listing, `DISCARDED` excluded, PG and D1 SQL variants
    - _Requirements: 2.4, 2.11, 3.7, 3.12_

  - [ ] 3.4 Implement `backend/src/services/vendorUploadHistoryService.js`
    - `resolveOwnerScope(user)` using `storeService.ensureBuyerAccountForUser`, `resolveBuyerOrgIdForScope`, and `buyerScopeIdsFor`; attribution always comes from the authenticated user, never the request body
    - `listHistory(user, paging)` returning the existing `VendorUploadHistoryBatch` shape (`id`, `fileName`, `uploadedAt`, `timestamp`, `total`, `imported`, `duplicates`, `failed`, `buyerId`, `buyerEmail`, `records`, `status`)
    - `importLegacyBatch(user, payload)` following the six steps in design.md: 403 on foreign owner keys; `ALREADY_IMPORTED` on a repeated `clientBatchId` without touching vendors; skip `FAILED`/`DUPLICATE`/`SKIPPED` records and `isRfqOrPoSummaryEntity` rows; dedupe within the payload; match existing organisation vendors by email, vendor code, and normalised name (`EXISTING`, no attribute overwrite); email owned by another buyer → `FOREIGN_OWNER`; otherwise create via `storeService.empanelIngestedVendor` with `source: 'buyer_uploaded'` and `{ allowUnassignedCategory: true }`; store every original record with its outcome in `raw.records`; use one transaction on PG and the idempotency key on D1
    - Structured logs for entry, per-batch outcome, and counts; audit entry per imported batch
    - Tests in `backend/__tests__/vendorUploadHistoryService.test.js`: owner match, foreign → 403, absent owner keys, `ALREADY_IMPORTED`, each record outcome, uncategorised records, RFQ/PO summary rows skipped, all records kept in `raw`
    - _Bug_Condition: isBugCondition(input) where operation = READ_UPLOAD_HISTORY or legacy records exist only locally_
    - _Expected_Behavior: Property 3 in design (owner-scoped, idempotent, lossless)_
    - _Preservation: server dedup (3.1), ownership filtering (3.2), RFQ/PO filtering (3.3)_
    - _Requirements: 2.4, 2.11, 2.14, 3.1, 3.2, 3.3, 3.12_

  - [ ] 3.5 Add upload-history controller and routes (declared before `/:id`)
    - Create `backend/src/controllers/vendorUploadHistoryController.js` with `getUploadHistory` and `importLegacyUploadHistory`; validate with `validatePayload` and return structured errors that name the offending fields (AGENTS.md §16, §17)
    - In `backend/src/routes/vendors.js`, declare BEFORE `router.get('/:id', ...)`:
      - `router.get('/upload-history', authenticate, requireRole('buyer'), vendorUploadHistoryController.getUploadHistory)`
      - `router.post('/upload-history/legacy-import', authenticate, requireRole('buyer'), <existing rate limiter>, vendorUploadHistoryController.importLegacyUploadHistory)`
    - Tests in `backend/__tests__/vendorUploadHistoryController.test.js` and a routes test: validation errors with field details, 401 without a token, 403 for non-buyers, `GET /api/vendors/upload-history` is not captured by the `/:id` handler, rate limiter applied to legacy-import
    - _Requirements: 2.4, 2.11, 2.14, 3.12_

  - [ ] 3.6 Write upload history on every server upload path
    - `backend/src/controllers/vendorController.js` `bulkImportVendors` (around line 2521): accept `fileName` and `clientBatchId`; for buyers insert a `BULK_IMPORT`/`PROCESSING` batch on the first chunk, increment counts and append record summaries on each chunk, set `COMPLETED` when the bulk session completes, return `uploadBatchId`; a history write failure is logged at WARN and does not fail the import
    - `backend/src/services/largeFileIngestionService.js` and `backend/src/controllers/vendorIngestionController.js`: insert an `INGESTION_JOB` batch when a `VENDOR_MASTER` job starts (for every file type, including rows sent from CSV/TSV/TXT), update counts and status as the job progresses
    - `cancelIngestionJob`: when `discardVendorMaster` is true, mark that session's batches `DISCARDED`
    - Extend `backend/__tests__/vendorControllerBranches.test.js`, `largeFileIngestionService.test.js`, and `vendorIngestionController.test.js` for the new branches, including the WARN path
    - _Bug_Condition: isBugCondition(input) where operation = UPLOAD_VENDOR_FILE_
    - _Expected_Behavior: every upload persisted and recorded on the server (Property 1)_
    - _Preservation: Excel start-job parsing, validation, polling, confirmation unchanged (3.6); discard on close (3.7)_
    - _Requirements: 2.3, 2.4, 3.6, 3.7_

  - [ ] 3.7 Add backend HTTP integration tests
    - In `backend/__tests__/vendorUploadHistoryHttp.test.js` (supertest, as in `vendorIngestionHttp.test.js`): bulk-import and start-job uploads appear in `GET /api/vendors/upload-history`; legacy-import replayed twice yields one batch and no duplicate vendors; a second buyer cannot read or import into the first buyer's organisation; a discarded session's batch is not listed
    - _Requirements: 2.4, 2.11, 2.14, 3.7, 3.12_

  - [ ] 3.8 Update frontend constants, types, schemas, and UI strings
    - `frontend/lib/constants.ts`: delete `reconcileBuyerVendorsWithUploadHistory`, `setVendorsActiveStateInStorage`, `updateVendorInUploadHistoryStorage`, `removeVendorsFromUploadHistoryInStorage`, `subscribeVendorUploadHistory`, and `matchesUploadHistoryRecord`; keep `VENDOR_UPLOAD_HISTORY_STORAGE_KEY`; rename `loadVendorUploadHistoryFromStorage` to `readLegacyVendorUploadHistory` (migration use only); add `VENDOR_UPLOAD_HISTORY_API` and `LEGACY_HISTORY_MIGRATION` (endpoints, retry backoff, max attempts per session, logger category `LEGACY_HISTORY_MIGRATION`)
    - `frontend/lib/types.ts`: extend `VendorUploadHistoryBatch` with `status`, `source`, `total`, `imported`, `duplicates`, `failed`, `timestamp`; add `LegacyUploadImportRequest`, `LegacyUploadImportResult`, `LegacyMigrationOutcome`
    - `frontend/lib/validationSchemas.ts`: mirror the legacy-import request schema
    - `frontend/lib/uiStrings.ts`: `UI_STRINGS.vendorUploadHistory.*` (loading, empty, load error with retry) and `UI_STRINGS.legacyHistoryMigration.*` (in progress, completed with counts, partial failure with "Retry Sync", session expired)
    - Update `frontend/__tests__/lib/constants.test.ts`: remove tests for deleted helpers, add tests for new exports, keep >= 90% coverage
    - _Requirements: 2.1, 2.5, 2.10_

  - [ ] 3.9 Implement `frontend/lib/vendorUploadHistoryApi.ts`
    - `fetchVendorUploadHistory(paging)` and `importLegacyUploadBatch(payload)` using the existing authenticated fetch helper and frontend logger
    - Tests in `frontend/__tests__/lib/vendorUploadHistoryApi.test.ts`: success, 4xx with field errors, 5xx, network error, 401
    - _Requirements: 2.4, 2.11_

  - [ ] 3.10 Implement the legacy migration module `frontend/lib/legacyVendorHistoryMigration.ts`
    - `migrateLegacyVendorUploadHistory({ activeBuyerAccount, sessionUser })`:
      1. Read batches with `readLegacyVendorUploadHistory`; return early if none or if the JSON is malformed (log and leave the key unchanged)
      2. Partition into owner-matching, foreign-owner, and ownerless batches using `buyerId`, `buyerEmail`, `organizationId`
      3. Ownerless batches (no `buyerId`, `buyerEmail`, or `organizationId`): leave them in storage untouched, do NOT migrate, do NOT display, do NOT count. Only log the number skipped (category `LEGACY_HISTORY_MIGRATION`, count only, no record contents). No confirmation prompt (resolved decision in design.md)
      4. Foreign-owner batches: leave untouched and never send (requirement 2.14)
      5. Send owner-matching batches one at a time with `clientBatchId = batch.id`; on `IMPORTED` or `ALREADY_IMPORTED` remove only that batch via read-modify-write of the current key value
      6. On any error (network, 4xx, 5xx, 401) stop, keep remaining batches, and schedule a retry on the next sign-in or bootstrap; show a toast with `UI_STRINGS.legacyHistoryMigration.*` and a "Retry Sync" action
      7. Remove the key only when no batches of any kind remain (so the key stays while ownerless or foreign-owner batches exist)
      8. Guard concurrent runs in one tab with a module-level promise
      9. After at least one batch is imported, call `refreshFromDB()`
    - Unit tests in `frontend/__tests__/lib/legacyVendorHistoryMigration.test.ts`: owner partitioning, ownerless batches untouched with the skipped count logged, foreign batches untouched, per-batch removal only after confirmation, stop-and-keep on error, 401 handling, concurrent-call guard, key kept while ownerless batches remain, key removed when empty, refresh after import
    - _Bug_Condition: legacy local history with records not on the server_
    - _Expected_Behavior: Property 3 in design_
    - _Preservation: auth and UI-preference keys untouched (3.8, 3.9)_
    - _Requirements: 2.11, 2.12, 2.13, 2.14_

  - [ ] 3.11 Write property test for the legacy migration
    - **Property 3: Legacy Migration** - One-time, owner-scoped, idempotent, lossless
    - In `frontend/__tests__/lib/legacyVendorHistoryMigration.pbt.test.ts`, generate legacy histories (owner-matching, foreign-owner, ownerless, malformed) and sequences of server responses (`IMPORTED`, `ALREADY_IMPORTED`, 4xx, 5xx, network error, 401) across repeated runs against an in-memory fake server keyed by `(organizationId, clientBatchId)`
    - Assert: only owner-matching batches are sent; at most one batch per `(organizationId, clientBatchId)` and no duplicate vendors on the fake server; a local batch is removed only after a confirmed response; foreign-owner and ownerless batches are byte-for-byte unchanged; the union of server-stored records and remaining local records equals the original record set
    - _Requirements: 2.11, 2.12, 2.13, 2.14_

  - [ ] 3.12 Fix `frontend/lib/store.tsx` (session cache, helper removal, migration trigger, history state)
    - Remove imports and calls of the deleted helpers (around lines 66–70, 2049–2055, 2291–2296, 2375, 2418–2430, 2500, 2696, 2825, 2903); `requestVendorEvaluation` and `resolveVendorMutationTarget` resolve vendors from `buyerVendors` only
    - Session-cache fix: initialise `loadedEntitiesRef` with `bootstrap: false`, `vendors: false`, `evaluations: false`, `rfqs: false` regardless of the `procucev_cache_*` sessionStorage contents (around line 491), so bootstrap always fetches from the server; cached arrays may still seed first paint and are replaced by the server response
    - After a successful buyer bootstrap, call `migrateLegacyVendorUploadHistory` once per signed-in user id
    - Expose `vendorUploadHistory`, `isLoadingVendorUploadHistory`, and `refreshVendorUploadHistory()`; log state changes through the frontend logger
    - Update `store.test.tsx`, `storeBranches.test.tsx`, `storeBooster.test.tsx`, and `storeSessionAndFeed.test.tsx`: cache seeds first paint and `/api/bootstrap` is still called; no localStorage writes after status, edit, or delete; migration runs once per user id; history state transitions
    - _Bug_Condition: isBugCondition(input) where operation ∈ {LOAD_WITH_SESSION_CACHE, CHANGE_VENDOR_STATUS, EDIT_VENDOR, DELETE_VENDOR, READ_EVALUATION_VENDORS}_
    - _Expected_Behavior: Property 1 in design; cache is a short-lived first-paint cache only_
    - _Preservation: single bootstrap request and payload shape (3.11); persisted-vendor mutations unchanged; theme key unchanged (3.9)_
    - _Requirements: 1.6, 1.8, 1.9, 2.6, 2.8, 2.9, 3.9, 3.11_

  - [ ] 3.13 Remove reconcile and localStorage vendor helpers from the four component consumers
    - `frontend/app/buyer/vendor-summary.tsx`: replace `reconciledBuyerVendors` with `buyerVendors` (around line 1640); remove the `storage` / `vendor_upload_history_updated` listeners (around lines 428–440) and the ownerless-batch display (around line 420); `loadUploadHistory` calls `refreshVendorUploadHistory()`; remove `setVendorsActiveStateInStorage` calls (around lines 1292, 1353); keep `handleDownloadBatchCsv` working with the server batch shape; show loading, empty, and error states from `UI_STRINGS.vendorUploadHistory.*`
    - `frontend/app/buyer/vendor-evaluation-summary.tsx` (around line 280), `frontend/app/buyer/ingestion-wizard.tsx` (around line 346), `frontend/app/buyer/ManualRFQModal.tsx` (around line 176): use `buyerVendors` directly and remove `subscribeVendorUploadHistory` / `loadVendorUploadHistoryFromStorage` usage; RFQ supplier options and "Select All" count come from `buyerVendors` filtered by `isVendorActive` and existing ownership rules
    - Update `vendor-summary.test.tsx`, `vendor-summaryBranches.test.tsx`, `vendor-evaluation-summary.test.tsx`, `ingestion-wizard.test.tsx`, `ingestion-wizardCoverage.test.tsx`, `ManualRFQModal.test.tsx`, `ManualRFQModalBranches.test.tsx`, and `ManualRFQModalQuotaBranches.test.tsx`; remove tests that depended on local history and add tests asserting server-only figures
    - Grep `frontend/app`, `frontend/lib`, and `frontend/components` to confirm no remaining references to the deleted helpers
    - _Bug_Condition: isBugCondition(input) where operation ∈ {READ_VENDOR_LIST, READ_VENDOR_COUNTS, READ_VENDOR_ATTRIBUTES, READ_UPLOAD_HISTORY, READ_RFQ_SUPPLIERS, READ_EVALUATION_VENDORS}_
    - _Expected_Behavior: figures equal a pure function of server data (Property 1)_
    - _Preservation: category normalisation (3.4), OCR/360° counts (3.5), empty-storage browsers unchanged (3.10), history scoped to the organisation (3.12)_
    - _Requirements: 1.1, 1.2, 1.5, 1.6, 1.7, 1.8, 2.1, 2.2, 2.5, 2.6, 2.7, 2.8, 3.4, 3.5, 3.10, 3.12_

  - [ ] 3.14 Unify the start-job upload path in `frontend/app/buyer/initial-setup-modal.tsx`
    - Parse client-side as today, then `POST /api/vendor-ingestion/:sessionId/start-job` with `rows` for CSV/TSV/TXT and Excel alike, for both `VENDOR_MASTER` and `PO_DUMP` (remove the `!isCsvOrText` guards around lines 1291 and 1748)
    - If no `sessionId` exists, create it with `POST /api/vendor-ingestion/session` before `start-job`
    - Remove the parallel `stream-upload` calls for these two flows (around lines 944–988 and 1429+) so a file is not ingested twice
    - Remove `localFallbackJob` / `localPoFallbackJob` as success states; on `start-job` failure set a `FAILED` job with the server or network error, a retry action, and `UI_STRINGS` text; keep `vendorMasterUploaded` false until the server accepts the job
    - Remove localStorage history writes (around lines 1227–1246 and 1329–1366) and the local discard filter (around lines 813–829); discard relies on `jobs/cancel` with `discardVendorMaster: true`
    - Update `frontend/__tests__/app/buyer/initial-setup-modal.test.tsx`: CSV, TSV, TXT, and Excel all call `start-job`; session created when missing; failure shows `FAILED`; no `stream-upload` for these flows; no localStorage writes; discard still sends `jobs/cancel`
    - _Bug_Condition: isBugCondition(input) where operation = UPLOAD_VENDOR_FILE AND (fileType ∈ {csv, tsv, txt} OR serverStartJobFailed OR sessionId IS NULL)_
    - _Expected_Behavior: shown as saved only after the server confirms (Property 1)_
    - _Preservation: Excel parsing, validation, polling, confirmation (3.6); discard of unconfirmed uploads (3.7)_
    - _Requirements: 1.3, 1.4, 2.3, 2.4, 3.6, 3.7_

  - [ ] 3.15 Move `frontend/app/category-manager/VendorUploadModal.tsx` to server history
    - Remove `HISTORY_STORAGE_KEY` and local history reads and writes (around lines 72, 97–104, 297–350)
    - Send `fileName` and `clientBatchId` with the first `bulkImportVendorRows` chunk; read history from the store's `vendorUploadHistory` and call `refreshVendorUploadHistory()` after a completed upload
    - Update `frontend/__tests__/app/category-manager/VendorUploadModal.test.tsx`: sends `fileName`/`clientBatchId`, no localStorage writes, history rendered from the store
    - _Bug_Condition: isBugCondition(input) where operation ∈ {UPLOAD_VENDOR_FILE, READ_UPLOAD_HISTORY}_
    - _Expected_Behavior: history stored on and read from the server (Property 1)_
    - _Preservation: bulk-import chunking and validation unchanged (3.6)_
    - _Requirements: 1.4, 2.3, 2.4, 3.12_

  - [ ] 3.16 Add frontend flow tests
    - Sign in with seeded owner-matching legacy history → migration runs → bootstrap refresh shows server vendors → migrated batches removed → a second render with empty storage shows the same figures
    - Seeded ownerless batch → not sent, not shown, not counted, still in storage, skipped count logged
    - CSV upload in initial setup → job polled from the server → history visible after `refreshVendorUploadHistory()`; close without confirming → batch hidden and vendors not shown
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.11, 2.12, 2.14, 3.7_

  - [ ] 3.17 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Local-only vendors inflate vendor figures and business writes bypass the server
    - **IMPORTANT**: Re-run the SAME test from task 1. Do NOT write a new test
    - The test from task 1 encodes the expected behavior; when it passes, the expected behavior is satisfied
    - Run `npm test --prefix frontend -- --coverageThreshold="{}" __tests__/app/buyer/vendorListLocalStorage.bugCondition.test.tsx`
    - If the test referenced deleted helpers only for seeding storage, keep the seeding via raw `localStorage.setItem` so the test still exercises seeded vs. empty storage
    - **EXPECTED OUTCOME**: Test PASSES (confirms the bug is fixed)
    - _Requirements: 2.1, 2.2, 2.3, 2.5, 2.7, 2.8, 2.9_

  - [ ] 3.18 Verify preservation tests still pass
    - **Property 2: Preservation** - Behaviour without browser-held business data is unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2. Do NOT write new tests
    - Run:
      - `npm test --prefix frontend -- --coverageThreshold="{}" __tests__/app/buyer/vendorListLocalStorage.preservation.test.tsx`
      - `npm test --prefix backend -- --coverageThreshold="{}" __tests__/vendorListPreservation.pbt.test.js`
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm all tests still pass after the fix
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12_

- [ ] 4. Back up and apply migration `0041_vendor_upload_batches` on stage and prod
  - Precondition: tasks 3.17 and 3.18 pass and the full local test suites pass
  - Ask the user to confirm before touching any shared database; this step is hard to reverse
  - Stage:
    - Back up the stage database BEFORE running the migration: `pg_dump --format=custom --file=backup-stage-<yyyymmdd-hhmm>.dump "$STAGE_DATABASE_URL"` for PostgreSQL, and `npx wrangler d1 export <stage-d1-name> --remote --output=backup-stage-<yyyymmdd-hhmm>.sql` for D1 (database names from `backend/wrangler` config)
    - Confirm the backup file exists and is non-empty, and store it outside the repository
    - Run `npm run db:migrate --prefix backend` with stage credentials (and `node scripts/migrate-d1.js` for stage D1 if used)
    - Verify `vendor_upload_batches` and both indexes exist and `schema_migrations` contains `0041_vendor_upload_batches`
  - Prod:
    - Back up the prod database BEFORE running the migration, using the same commands with prod credentials. `deploy-prod.yml` runs `node scripts/migrate-d1.js --prod` automatically, so the D1 backup must be taken before that workflow is triggered
    - Confirm the backup file exists and is non-empty
    - Run `npm run db:migrate --prefix backend` with prod credentials (or let the deploy workflow apply the D1 migration after the backup)
    - Verify the table, indexes, and `schema_migrations` row as on stage
  - Record the backup file names and timestamps in the PR description
  - _Requirements: 2.4_

- [ ] 5. Checkpoint - Ensure all tests pass
  - Run the frontend and backend suites with non-watch commands:
    - `npm run test:coverage --prefix backend`
    - `npm run test:coverage --prefix frontend`
    - `npm run check:coverage`
  - Confirm zero failures and >= 90% statements, branches, functions, and lines for every touched and new file
  - Run `npm run typecheck`, `npm run lint`, `npm run check:db-schema-parity`, and `npm run check:fast`
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Ownerless legacy batches (no `buyerId`, `buyerEmail`, or `organizationId`) stay in browser storage untouched. They are not migrated, not displayed, and not counted; the migration only logs how many were skipped (resolved decision in design.md).
- Line numbers cited in tasks come from the design and are approximate; locate code by symbol name.
- Task 4 touches shared databases and needs user confirmation before it runs.
