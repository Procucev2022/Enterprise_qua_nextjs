# GST/GSTIN Validation & Buyer Profile Category Fixes - Implementation Plan

**Task**: 
1. Add GSTIN validation to vendor upload (Step 2 Vendor Master) with per-row error display
2. Fix buyer profile category section: move "Save Category" button to bottom, remove duplicate save button, add max 10 category limit
3. Identify and remove highlighted text from buyer profile if present

---

## Discovery Summary

### Project Structure
- **Frontend Path**: `frontend/`
- **Build System**: npm with workspaces
- **Test Framework**: Jest with TypeScript (vitest integration)
- **Test Coverage Requirement**: 90% per-file (Statements, Branches, Functions, Lines)
- **Build/Test Commands**: `npm run qc` (full check), `npm run qc:fast` (changed files), `npm run typecheck`, `npm run lint`, `npm run test:coverage`

### Current State

#### 1. GSTIN Validation Status
- **Validation Function**: `validateGstin()` exists in `frontend/lib/validationSchemas.ts` (comprehensive, 15-character format, PAN validation, state code, entity code, Z position, checksum in production)
- **Usage in Forms**: Already applied in vendor-profile.tsx (single vendor add form)
- **Usage in Uploads**: `validateGstin()` imported in `frontend/lib/vendorUploadClient.ts` but validation happens only at row level submission, not on upload initiation
- **Issue**: Vendor summary page doesn't validate GST rows before allowing upload; validation logic exists but not wired into the upload flow

#### 2. Buyer Profile Category Section Status
- **Current File**: `frontend/app/buyer/buyer-profile.tsx`
- **Current State**:
  - **Button Position**: "Save Category" button is at the TOP of the category section (line 1047-1051), above the search bar
  - **Duplicate Buttons**: Two "Save Organization Profile" buttons exist:
    - Top button (line 1017-1023): Full profile save
    - Duplicate button above categories (not found in read, need verification)
  - **Category Limit**: `MAX_MINOR_CATEGORIES = 10` defined in `frontend/lib/constants.ts` (BUYER_PROFILE_LIMITS)
  - **Current Limit Display**: Badge shows selected count but doesn't block at 10
  - **Highlighted Text**: Need to identify what "highlighted text" refers to—likely stale UI copy or placeholder elements

#### 3. Test Coverage
- Existing GST validation test suite: `frontend/__tests__/lib/gstValidation.test.ts` (28 tests, >90% coverage)
- Buyer profile tests exist but category-specific tests need verification for new logic

---

## Implementation Plan

### 1. Add GSTIN validation to vendor upload flow with per-row error display
**What**: Wire the existing `validateGstin()` function into the vendor upload preview. Display validation errors per row before allowing upload, block upload if any GSTIN is invalid.

**Files**: 
- `frontend/app/buyer/vendor-summary.tsx` (vendor upload modal / step 2 integration point)
- `frontend/lib/vendorUploadClient.ts` (validation logic)
- `frontend/__tests__/lib/vendorUploadClient.test.ts` (tests - create if missing)
- `frontend/__tests__/app/buyer/vendor-summary.test.tsx` (integration tests)

**Changes**:
- **vendorUploadClient.ts**: Add a `validateVendorRowGstin()` function that wraps `validateGstin()` and formats the error message for display
- **vendor-summary.tsx**: In the upload preview table, add a validation status column showing:
  - ✅ if GSTIN is valid or empty (optional field)
  - ❌ with error message if GSTIN is invalid
  - Disable "Upload" button if any row has GSTIN error
- Implement visual feedback: highlight invalid GSTIN cells with error border/background
- Add tooltip/popover showing the error message on hover

**Verification**:
- Run `npm test --prefix frontend -- __tests__/lib/vendorUploadClient.test.ts` — new validation tests pass
- Run `npm test --prefix frontend -- __tests__/app/buyer/vendor-summary.test.tsx --coverage` — all tests pass, >90% coverage on vendor-summary.tsx for GSTIN validation logic
- Run `npm run check:fast` — fast verification for changed files passes

---

### 2. Fix buyer profile category section button placement and limit enforcement
**What**: 
- Move "Save Category" button from top (above search) to bottom (below category list)
- Remove any duplicate "Save Organization Profile" button in the category section header
- Enforce 10-category max limit: prevent selecting more than 10 total minor categories, show clear warning
- Identify and remove any highlighted text (stale UI copy)

**Files**: 
- `frontend/app/buyer/buyer-profile.tsx`
- `frontend/lib/constants.ts` (verify MAX_MINOR_CATEGORIES value)
- `frontend/lib/uiStrings.ts` (UI text for warning message)
- `frontend/__tests__/app/buyer/buyer-profile.test.tsx` (tests)

**Changes**:
1. **Button Placement**:
   - Remove/delete the "Save Category" button from line ~1047 (top of category section, above search bar)
   - Add new "Save Category" button at the bottom of the category list, after all categories are listed, inside a `<div className="flex justify-end">` for consistent styling with the top Save Organization Profile button
   - Button should be disabled when no categories are selected or when saving is in progress

2. **Category Limit**:
   - Add state validation: when user tries to select a 11th category, prevent the checkbox from being checked
   - Show inline warning message: "Maximum 10 categories allowed. Deselect a category to add another."
   - Update the badge at the top to show: "{count}/10 Selected" with color change to amber when at limit
   - If limit is already set in the existing code, verify it works and add tests

3. **Duplicate Button Removal**:
   - Verify if there's a duplicate "Save Organization Profile" button in the category section header (lines ~1010-1025)
   - If present, remove it (keep only the top Save Organization Profile button at line 1017)

4. **Highlighted Text**:
   - Search for any `className` containing "highlight" or similar styling
   - Look for any unused/outdated copy like "highlighted", "demo", "placeholder"
   - If found and not critical to UX, remove or hide via CSS

**Verification**:
- Run `npm test --prefix frontend -- __tests__/app/buyer/buyer-profile.test.tsx --coverage` — existing tests pass, new tests for category limit and button placement pass
- Run `npm test --prefix frontend` — all tests pass with >90% coverage
- Manual smoke test: Open buyer profile, select categories up to 10, verify 11th is blocked, see warning message

---

### 3. Write unit tests for new GSTIN upload validation and category limit
**What**: Add comprehensive test coverage for the new validation and UI constraints.

**Files**: 
- `frontend/__tests__/lib/vendorUploadClient.test.ts` (create new if missing)
- `frontend/__tests__/app/buyer/vendor-summary.test.tsx` (add tests for GSTIN preview validation)
- `frontend/__tests__/app/buyer/buyer-profile.test.tsx` (add tests for category limit enforcement)

**Changes**:
- **vendorUploadClient.test.ts**:
  - Test: `validateVendorRowGstin accepts valid GST like '27ABCDE1234F1Z5'` → returns valid
  - Test: `validateVendorRowGstin rejects invalid GST like 'EF#FD'` → returns error with message
  - Test: `validateVendorRowGstin rejects short GST like '123456789'` → returns error
  - Test: `validateVendorRowGstin accepts empty GSTIN (optional field)` → returns valid

- **vendor-summary.test.tsx**:
  - Test: `upload preview shows GSTIN validation error for invalid row` → verify error cell displays
  - Test: `upload button is disabled when any GSTIN row is invalid` → prevent upload
  - Test: `upload button is enabled when all GSTIN rows are valid or empty` → allow upload

- **buyer-profile.test.tsx**:
  - Test: `category selection is blocked at 10 categories with warning message` → prevent 11th selection
  - Test: `category limit badge shows "10/10 Selected" when at limit` → visual feedback
  - Test: `Save Category button is positioned at bottom of category list` → verify DOM order
  - Test: `duplicate Save Organization Profile button is not present in category section` → verify cleanup

**Verification**:
- Run `npm test --prefix frontend -- --coverage` — all new tests pass, >90% coverage on modified files

---

### 4. Build and full quality check
**What**: Run the complete quality pipeline to ensure no regressions and all coverage targets are met.

**Verification**:
- `npm run typecheck` — zero TypeScript errors
- `npm run lint --prefix frontend` — zero ESLint issues
- `npm run build --prefix frontend` — production build succeeds
- `npm run test:coverage --prefix frontend` — all tests pass, 90% coverage on changed files (vendor-summary.tsx, vendorUploadClient.ts, buyer-profile.tsx)
- `npm run check:coverage --prefix frontend` — per-file coverage verified
- `npm run qc` — full workspace quality check passes

---

## Files Modified Summary

| File | Changes | Lines Affected | Type |
|------|---------|-----------------|------|
| `frontend/app/buyer/vendor-summary.tsx` | Add GSTIN validation status display, disable upload on error | TBD | Feature |
| `frontend/lib/vendorUploadClient.ts` | Add `validateVendorRowGstin()` wrapper function | ~5-10 | Feature |
| `frontend/app/buyer/buyer-profile.tsx` | Move Save Category button to bottom, enforce 10-category limit, remove duplicate button | ~20-30 | Fix |
| `frontend/lib/constants.ts` | Verify MAX_MINOR_CATEGORIES = 10 (no changes if already set) | 0 | Verify |
| `frontend/__tests__/lib/vendorUploadClient.test.ts` | Add GSTIN validation tests | ~40-50 new tests | Test |
| `frontend/__tests__/app/buyer/vendor-summary.test.tsx` | Add upload preview validation tests | ~30-40 new | Test |
| `frontend/__tests__/app/buyer/buyer-profile.test.tsx` | Add category limit and button placement tests | ~40-50 new | Test |

---

## Branch & Commit
- **Branch**: `fix/gstin-vendor-upload-category-limits`
- **Commit Message**: `fix: add GSTIN validation to vendor upload, enforce 10-category limit in buyer profile, reorganize buttons`
  - Details: Wire validateGstin() into vendor upload preview with per-row error display and upload block. Move Save Category button to bottom of category section in buyer profile. Enforce maximum 10 minor categories with warning message. Remove duplicate save buttons. Add comprehensive unit tests for all changes.

---

## Success Criteria
1. ✅ Vendor upload preview shows GSTIN validation errors per row (e.g., 'EF#FD', '123456789' rejected)
2. ✅ Upload button is disabled while any GSTIN row has validation error
3. ✅ Buyer profile category selection blocks at 10 categories with clear warning
4. ✅ "Save Category" button moved to bottom of category list
5. ✅ Duplicate/unwanted save buttons removed from category section
6. ✅ All new unit tests pass with >90% coverage on modified files
7. ✅ Full build and quality pipeline pass: typecheck, lint, tests, coverage
8. ✅ No regressions in existing vendor upload or profile functionality
9. ✅ Code follows AGENTS.md standards: 90% coverage, centralized validation, accessibility

---

## Notes
- GSTIN validation logic (`validateGstin()`) already exists and is production-ready with checksum validation
- Category max limit constant (10) already defined in constants.ts; just needs enforcement UI
- Tests must achieve >90% per-file coverage per AGENTS.md mandatory requirement
- All UI changes must remain declarative (state-driven, no direct DOM manipulation)
