# Universal AI Coding Agent Instructions & Engineering Standards

All AI coding assistants (including Antigravity, Gemini, Cursor, Claude, Codex, GitHub Copilot, Kiro, etc.) working on this repository **MUST** strictly adhere to the following mandatory protocols:

---

## 1. 90% Unit Test Code Coverage Benchmark (Strict Per-File Enforcement)
- Every single application code file in `frontend/` and `backend/` **MUST** achieve at least **90% unit test coverage** individually across all four metrics:
  - **Statements: >= 90%**
  - **Branches: >= 90%**
  - **Functions: >= 90%**
  - **Lines: >= 90%**
- **Zero file exclusions**: Do not skip or exclude any application file from testing or coverage thresholds.
- If even a single file falls below 90% in any of the four parameters, the test run fails, an error is thrown, and it must be corrected before concluding the task.

---

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

---

## 3. Global Test Timeout
- All tests must respect the global timeout of **20,000 ms** (20 seconds) defined in `jest.config.js`.
- Async tests and API mock calls must settle quickly and reliably without hanging.

---

## 4. User Prompt History Maintenance (`prompts.md`)
- Maintain a file in the workspace root named `prompts.md` for saving user-provided prompts.
- **Rule**: Save **ONLY** user-provided prompts in `prompts.md`. Do **NOT** record AI-generated conversations or assistant responses in this file.
- Each user prompt must be appended with its timestamp and exact user prompt text.

---

## 5. Structured Centralized Logging & Logs Storage
- Implement and maintain a structured, centralized logging system for persistence, searchability, and automatic purging to manage storage and compliance.
- When running locally, all logs must be persisted in the file system under `backend/logs/` (e.g. `app.log`, `error.log`, `audit.log`) for future reference and debugging.
- Implement automatic purging with retention policies (e.g. max age, max size) to manage disk space and compliance.

---

## 6. Detailed Application Logging Standard
- Apply detailed, structured logging across all layers of the application:
  - **Backend**: Log controller entries, service operations, database query executions, incoming HTTP requests, and error traces with structured metadata (timestamps, levels, categories, request IDs).
  - **Frontend**: Log user actions, store state changes, API calls, and error handling via the centralized frontend logger.
- Never strip or bypass logging when adding or refactoring features.

---

## 7. Database Optimization & Query Efficiency Standard
- **Query Auditing & Efficiency**: Continuously audit database queries for execution efficiency. Ensure appropriate indexing on frequently filtered columns (e.g., `rfq_number`, `corporate_email`, `major_category`, `sourcing_mode`), prevent N+1 queries, eliminate full-table scans, and profile query latencies.
- **Minimizing Compute Hours & Resource Usage**:
  - Implement an intelligent query caching layer (TTL & LRU eviction with write-through invalidation) to minimize redundant database compute hours and eliminate unnecessary network roundtrips.
  - Optimize connection pool lifecycle (`idleTimeoutMillis`, `max`, `min`) to aggressively release idle database connections, reducing active instance compute billing on managed and serverless database providers (Azure PostgreSQL Flexible Server, AWS RDS, Neon, Supabase).
  - Profile and log slow queries with execution timings to identify potential optimization bottlenecks.

---

## 8. GraphQL Integration & Streamlined Data Fetching Standard
- **Unified & Streamlined Fetching**: Integrate and maintain a GraphQL API layer (`/graphql`) allowing frontend clients and microservices to request exactly the required fields, eliminating over-fetching and under-fetching.
- **Batched & Composite Queries**: Support batched queries across multiple domain entities (RFQs, Vendors, Buyer Accounts, Evaluations, Audit Logs, System Config, Catalogue, and Infrastructure Health) in a single roundtrip to maximize network and compute efficiency.

---

## 9. Tech Stack LTS/Stable Version Upgrade & Dependency Maintenance Protocol
- **Regular Stack & Dependency Auditing**: Regularly audit, upgrade, and maintain all core tech stack components, runtime environments, framework dependencies, and third-party libraries to their latest Long-Term Support (LTS) or stable versions.
- **Refactoring Breaking Changes & Deprecations**: Ensure that all breaking changes, deprecation warnings, and API updates from upgraded packages are systematically refactored across the entire codebase.
- **Verification & Compatibility Gate**: Validate all upgrades by executing the full test suite, linting, typechecks, and the per-file 90% coverage benchmark to guarantee backward compatibility, operational stability, and optimal performance.

---

## 10. Auto-Resolve Bugs & Errors in Logs Standard
- **Continuous Log Auditing & Parsing**: Continuously monitor and analyze application bugs, uncaught exceptions, and error codes captured in log files (`app.log`, `error.log`, `audit.log`) and runtime console streams.
- **Root-Cause Diagnosis & Automated Remediation**: Parse stack traces, error payloads, and fault origins to automatically diagnose underlying failure mechanisms, implement verified code fixes, and prevent recurring failures.
- **Zero-Regression Verification**: Validate all bug fixes through the full quality pipeline (typechecking, linting, unit test suites, and the strict per-file 90% coverage threshold) to ensure complete stability without side effects.

---

## 11. Auto-Resolve Warnings Standard
- **Comprehensive Warning Detection**: Automatically identify, inspect, and resolve all compiler, linter, runtime, React hook, and dependency warnings across frontend and backend codebases.
- **Safe Proactive Refactoring**: Proactively refactor deprecation notices, unused imports, type mismatches, non-standard syntax, unhandled promises, and React DOM/hook warnings without disrupting business logic.
- **Verification Gate**: Re-run the full test suite, build pipeline, and coverage verifier to confirm that all warnings are resolved cleanly with zero regressions.

---

## 12. Automated Performance Optimization Standard
- **Continuous Performance Auditing**: Continuously profile and audit critical execution paths, database query latencies, API payload sizes, and frontend rendering performance across the entire codebase.
- **Automated Optimizations**: Proactively implement code-splitting, lazy-loading, resource caching (HTTP cache headers, LRU query caching, client-side store memoization), and payload minification.
- **Benchmark Validation**: Validate all optimizations against established bundle size and latency benchmarks via the quality check pipeline, ensuring optimal load times and minimal compute consumption.
