# GST Amount Display in Buyer Quote Matrix

The fix restores missing GST amounts in the quote matrix page by implementing a priority-based calculation: use backend-calculated `quote.taxes` when available (> 0), otherwise fall back to calculating from `quote.taxRate`, and show "Not available" only when both are missing. The Grand Total row now correctly sums Subtotal + GST + Delivery Charges. Comprehensive test coverage (7 new tests) verifies all GST scenarios, with per-file coverage meeting 90% enforcement.

**Watch for:** The fix correctly prioritizes backend-calculated tax over rate-based calculation, ensuring accuracy. The UI string reference (`UI_STRINGS.rfqDetails.unsetValue`) is used for the "Not available" fallback. All tests pass with zero failures and full 90% per-file coverage verified.

**Verdict**: APPROVED

---

## High-level view

The quote matrix component was displaying "Not available" in the GST row even when backend-calculated tax amounts were present in the quote object. The fix introduces a layered calculation approach that checks for `quote.taxes` first (backend-computed precision), then falls back to deriving the tax from `quote.taxRate` (percentage-based), and only shows "Not available" when both are missing. This prevents false negatives while maintaining the ability to calculate tax from rate when direct amounts aren't provided.

The display layer separately calculates an effective tax rate percentage to show alongside the currency amount. When the tax derives from a backend amount, the rate is computed backward as `(taxes / lineTotal) * 100`; when it derives from the rate, that rate is used directly. This ensures the UI displays meaningful percentage context regardless of the calculation source.

Test coverage includes all primary paths: backend tax present, rate-only scenarios, missing data, zero tax (tax-exempt items), and multi-item line-item-wise comparisons. The verification report confirms 7 new tests all passing, TypeScript strict mode compliance, ESLint pass, and per-file 90% coverage met.

---

<details>
<summary>Issues (0)</summary>

No blocking concerns identified.

</details>

<details>
<summary>Details</summary>

## GST Calculation Priority Logic

The fix implements a three-tier fallback: use `quote.taxes` if present and > 0 (backend-computed), otherwise calculate from `quote.taxRate`, otherwise return `null` (displays "Not available"). This avoids the prior bug where `taxRate` defaulting to 18 masked missing backend amounts. The calculation is wrapped in an IIFE for clarity.

## Display Rate Calculation

A separate `displayTaxRate` calculation shows the percentage context. When tax derives from a backend amount, the rate is computed backward as `(taxes / lineTotal) * 100`, preserving the actual effective rate. When deriving from the original `taxRate`, that rate is displayed. This keeps the two concerns independent: what tax amount to use vs. what percentage to display.

## UI String Constant for Fallback

The fallback "Not available" text uses `UI_STRINGS.rfqDetails.unsetValue`, maintaining consistency with centralized string management and enabling i18n.

## Test Scenarios Coverage

Seven new tests cover: backend tax present, rate-only, priority preference (direct amount over rate), missing both, zero tax (tax-exempt), rate display derived from amount, and multi-item line-item-wise comparisons. All pass with zero failures and >= 90% per-file coverage.

## Grand Total Recalculation

The Grand Total row now correctly computes Subtotal + GST + Delivery Charges. Prior to this fix, GST displayed "Not available", causing Grand Total calculations to fail or show incorrect values.

## Line-Item-Wise Context

GST calculation runs per line item per vendor within the itemized comparison loop, isolating tax computations to the specific scope and ensuring accuracy when vendors provide itemized quotes at different granularities.

## Verification Standards Compliance

Changes satisfy workspace mandatory standards: 90% per-file coverage verified across statements, branches, functions, lines; TypeScript strict mode with explicit `number | null` typing; zero ESLint warnings/errors; 42 tests passed (7 new GST tests) in 5.021s.

</details>

---

## File map

<details>
<summary>Files changed (2 application files)</summary>

- **frontend/app/buyer/quote-matrix.tsx** — GST calculation logic updated to check for `quote.taxes` first, fall back to `quote.taxRate`, and show "Not available" only when both missing. Display rate computed separately to show effective percentage. Uses `UI_STRINGS.rfqDetails.unsetValue` for fallback text. PO modal line-item mapping enhanced to pass technical specs and lineItemQuotes.

- **frontend/__tests__/app/buyer/quote-matrix.test.tsx** — 7 new test cases added to "GST Amount Display and Calculation" suite covering backend tax, rate-only, priority preference, missing data, zero tax, rate display, and multi-item scenarios. All pass with >= 90% coverage per file metric.

**Full diff**: `git diff main fix/gst-amount-display -- frontend/app/buyer/quote-matrix.tsx frontend/__tests__/app/buyer/quote-matrix.test.tsx`

</details>
