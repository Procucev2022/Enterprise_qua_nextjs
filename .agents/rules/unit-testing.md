---
name: unit-testing-rules
description: Strict unit testing rules and 90% per-file coverage enforcement for all code modifications
---

# Antigravity Rule: Unit Testing & 90% Per-File Coverage Enforcement

When working in this repository:
1. **Never Skip Files**: Every code file in `app/` and `lib/` must have a corresponding test suite in `__tests__/`.
2. **90% Threshold Per File**:
   - Statements >= 90%
   - Branches >= 90%
   - Functions >= 90%
   - Lines >= 90%
3. **Execute Verification**:
   Always run `npm run test:coverage` after modifying any code to ensure tests pass and coverage benchmarks are satisfied.
4. **Global Timeout**:
   Tests must complete within the 20-second global timeout.
