# GST Amount Display Fix - Implementation Plan

**Task**: Fix missing GST amount display in the buyer quote matrix page (qua.procucev.com/buyer/quote-matrix). Currently shows 'Not available' instead of the calculated GST amount. Subtotal (Base) shows correctly but Grand Total also shows 'Not available' because it depends on GST.

---

## Discovery Summary

### Issue Root Cause
The quote matrix page (`frontend/app/buyer/quote-matrix.tsx`, line 745-746) calculates GST/tax only from `quote.taxRate`, but doesn't fall back to the actual `quote.taxes` amount that is already populated in the quote data.

**Current Logic**:
```typescript
const taxRate = typeof quote.taxRate === 'number' ? quote.taxRate : null;
const estTax = lineTotal !== null && taxRate !== null ? Math.round((lineTotal * taxRate) / 100) : null;
```

This means GST only displays if `taxRate` is explicitly set; if the quote has only `taxes` (the actual GST amount), it's ignored and shows "Not available".

### Data Flow
1. Backend returns quotes with `taxes: number` (the calculated GST amount) and optionally `taxRate: number` (rate percentage)
2. The PurchaseOrderModal (Modals.tsx:324-326) correctly handles this: uses `quote.taxes` directly if available
3. The quote-matrix page doesn't use this same pattern

### Comparison with Working Implementation
The PurchaseOrderModal (lines 322-327 in Modals.tsx) correctly shows GST:
```typescript
const gstAmount: number | null = quote?.taxes && quote.taxes > 0 ? quote.taxes : null;
const gstRate: number | null = gstAmount !== null && subTotal !== null && subTotal > 0 
  ? Math.round((gstAmount / subTotal) * 100) : null;
const grandTotal: number | null = gstAmount === null || subTotal === null ? null : subTotal + gstAmount;
```

---

## Implementation Plan

### 1. Fix GST calculation logic in quote-matrix.tsx
**What**: Update the GST calculation in the line-item-wise comparison section to use `quote.taxes` directly when available, matching the PurchaseOrderModal pattern. Fall back to calculating from `taxRate` only if no direct tax amount exists.

**Files**: 
- `frontend/app/buyer/quote-matrix.tsx` (lines 745-746 and display logic at 779-780)

**Changes**:
- Line 745-746: Replace the taxRate-only logic with logic that:
  1. First checks if `quote.taxes` exists and is greater than 0 → use it directly
  2. Otherwise, check if `quote.taxRate` exists → calculate from rate
  3. Otherwise → null (show "Not available")
- Also compute `taxRate` for display purposes (from taxes if direct amount exists, from taxRate if rate-based)
- Update the display text at line 779 to show the actual rate when available

**Verification**:
- Run `npm test --prefix frontend -- __tests__/app/buyer/quote-matrix.test.tsx` — existing tests pass
- Run `npm run check:fast` — fast verification for changed file passes

---

### 2. Add comprehensive unit tests for GST display
**What**: Write tests covering GST display logic in the line-item comparison table with multiple scenarios:
- Quote with direct `taxes` amount (backend-calculated) → should display GST amount and percentage
- Quote with `taxRate` only → should calculate and display GST
- Quote with both → should prefer direct `taxes` amount
- Quote with neither → should show "Not available"

**Files**: 
- `frontend/__tests__/app/buyer/quote-matrix.test.tsx`

**Changes**:
- Add new test: `'displays GST from quote.taxes when available'` → mock quote with `taxes: 1200`, verify display shows formatted GST
- Add new test: `'calculates GST from taxRate when taxes not available'` → mock quote with `taxRate: 18` but no `taxes`, verify calculation
- Add new test: `'prefers direct taxes amount over calculated taxRate'` → mock both, verify uses `taxes`
- Add new test: `'shows not available when neither taxes nor taxRate present'` → verify fallback text

**Verification**:
- Run `npm test --prefix frontend -- --coverage __tests__/app/buyer/quote-matrix.test.tsx` — confirm >90% coverage on quote-matrix.tsx
- Run `npm run check:coverage --prefix frontend` — entire quote-matrix.tsx meets 90% threshold

---

### 3. Add tests for Grand Total calculation (depends on GST)
**What**: The Grand Total (Subtotal + GST + Delivery Charges) depends on GST being available. Add tests to verify the entire calculation chain works when GST is displayed.

**Files**: 
- `frontend/__tests__/app/buyer/quote-matrix.test.tsx`

**Changes**:
- Add new test: `'line-item total includes GST and delivery charges in summary'` → verify complete calculation

**Verification**:
- Run `npm test --prefix frontend -- __tests__/app/buyer/quote-matrix.test.tsx` — new test passes
- Run `npm run check:coverage --prefix frontend` — quote-matrix.tsx maintains >90% coverage

---

### 4. Verify no regressions in Modals and PurchaseOrderModal
**What**: Ensure the PurchaseOrderModal (which already displays GST correctly) still works with the quote data, and test integration between quote-matrix and the modal.

**Files**: 
- `frontend/__tests__/app/components/Modals.test.tsx` (existing tests)

**Verification**:
- Run `npm test --prefix frontend -- __tests__/app/components/Modals.test.tsx` — all PurchaseOrderModal tests pass
- Run `npm test --prefix frontend` — all frontend tests pass

---

### 5. Build and full quality check
**What**: Run the complete quality pipeline to ensure no regressions and all coverage targets are met.

**Verification**:
- `npm run typecheck --prefix frontend` — zero TypeScript errors
- `npm run lint --prefix frontend` — zero linting issues
- `npm run build --prefix frontend` — production build succeeds
- `npm run test:coverage --prefix frontend` — all tests pass, 90% coverage on changed files
- `npm run check:coverage --prefix frontend` — per-file coverage verified

---

## Branch & Commit
- **Branch**: `fix/gst-amount-display`
- **Commit Message**: `fix: display GST amount in quote matrix when taxes available`
  - Details: Update line-item GST calculation to use quote.taxes directly when available, falling back to taxRate calculation. Add comprehensive tests covering all GST scenarios.

---

## Success Criteria
1. GST row displays the actual GST amount (not "Not available") when quote data contains `taxes` or `taxRate`
2. All new unit tests pass and cover >90% of quote-matrix.tsx logic
3. No regressions in PurchaseOrderModal or other quote-related components
4. Full build and quality pipeline pass with zero errors
5. Code follows AGENTS.md standards: 90% coverage, centralized types, declarative UI, accessibility

