# Universal AI Coding Agent Instructions & Unit Testing Standards

All AI coding assistants (including Antigravity, Gemini, Cursor, Claude, Codex, GitHub Copilot, Kiro, etc.) working on this repository **MUST** adhere to the following mandatory testing protocols:

## 1. 90% Unit Test Code Coverage Benchmark (Strict Per-File Enforcement)
- Every single application code file in `frontend/` and `backend/` **MUST** achieve at least **90% unit test coverage** individually across all four metrics:
  - **Statements: >= 90%**
  - **Branches: >= 90%**
  - **Functions: >= 90%**
  - **Lines: >= 90%**
- **Zero file exclusions**: Do not skip or exclude any application file from testing or coverage thresholds.
- If even a single file falls below 90% in any of the four parameters, the test run fails, an error is thrown, and it must be corrected before finishing the task.

## 2. Automated Test Verification on Every Change
Whenever making any code changes or adding new features:
1. Immediately write or update corresponding unit tests in `frontend/__tests__/` or `backend/__tests__/`.
2. Run the test suite with coverage enforcement:
   ```bash
   # From root:
   npm run test:coverage
   # Or individually:
   npm run test:coverage --prefix frontend
   npm run test:coverage --prefix backend
   ```
3. Run the coverage verification checker:
   ```bash
   npm run check:coverage
   ```
4. Verify that all unit tests pass with zero errors and that the coverage report shows `>= 90%` across all parameters for each individual file.

## 3. Global Test Timeout
- All tests must respect the global timeout of **20,000 ms** (20 seconds) defined in `jest.config.js`.
- Async tests and API mock calls must settle quickly and reliably without hanging.

## 4. Test Structure and Practices
- Place test files in `__tests__/`, mirroring the project source directory structure (e.g. `frontend/__tests__/app/buyer/command-center.test.tsx`, `backend/__tests__/rfqController.test.js`).
- Clean up mocks, timers, and DOM nodes in `beforeEach` / `afterEach`.
- Use `@testing-library/react` and `fireEvent` / `userEvent` for component testing.
- Test edge cases, validation error branches, loading states, and fallback states to ensure comprehensive branch and line coverage.
