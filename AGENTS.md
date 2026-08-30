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

---

## 13. Quality Check Pipeline & Multi-Project Verification Protocol
- **Mandatory Quality Check Execution**: After every code change, AI agents **MUST** run the comprehensive workspace quality check pipeline.
- **Strict Verification Sequence**:
  1. **Production Build & Asset Verification**: `npm run build` (Ensures compilation, bundling, and prerendering succeed).
  2. **Unit Test & 90% Per-File Coverage Enforcement**: `npm run test:coverage` and `npm run check:coverage` (Enforces per-file $\ge 90\%$ benchmarks across statements, branches, functions, and lines with 0 failures).
  3. **TypeScript Static Typecheck**: `npm run typecheck` (Ensures zero type errors).
  4. **Linting & Code Style Analysis**: `npm run lint` (Ensures zero ESLint warnings and errors).
  5. **Database Schema & Migrations Verification**: `npm run db:migrate` (Applies and verifies pending schema updates and seed integrity).
- **Workspace-Wide Global Commands**:
  - Run full quality check across all workspace projects:
    ```bash
    npm run check:quality
    # Or shorthand:
    npm run qc
    ```
- **Fast Change Verification**:
  - For rapid iterative feedback during active edits, run the fast verification command to validate modified files:
    ```bash
    npm run check:fast
    # Or shorthand:
    npm run qc:fast
    ```

---

## 14. CI/CD Quality Gate & Pull Request Reporting Protocol
- **Continuous Integration Gate (`.github/workflows/ci.yml`)**: Every pull request and push to main branches must automatically trigger the comprehensive quality pipeline (linting, build verification, TypeScript typecheck, database migrations, and unit test execution).
- **Strict Per-File 90% Enforcement in CI**: If any unit test fails or if even a single file falls below 90% coverage in lines, statements, branches, or functions, the CI workflow run MUST fail.
- **Automated Pull Request Summary Comments**: The CI workflow must automatically generate and post a formatted markdown comment on each pull request detailing:
  - Total unit tests executed, passed, failed, and skipped.
  - Overall coverage breakdown (Statements, Branches, Functions, Lines).
  - Per-file coverage status confirming 100% compliance across all workspace projects.
  - Status of build, lint, typecheck, and database schema migrations.

---

## 15. Environment Variables Example & Secrets Sanitation Standard
- **Centralized `.env.example` Maintenance**: Maintain and regularly update `.env.example` at the workspace root, `backend/.env.example`, and `frontend/.env.example` with all configuration variables used across the application.
- **Zero Hardcoded Secrets or Credentials**: Never hardcode sensitive data, API keys, passwords, database credentials, or secret tokens anywhere in the codebase. All runtime configuration values must be read from `process.env` with safe default fallbacks.
- **Synchronization Gate**: Whenever new environment variables are introduced or refactored, immediately document them with descriptions and safe placeholder values in all `.env.example` files.

---

## 16. Comprehensive and Descriptive UI Error Messaging Standard
- **Context-Rich, Actionable Error Messages**: Always implement user-facing error messages that clearly present actionable context, specific failure details, and recovery guidance rather than generic error codes or uninformative alerts.
- **Categorized Error Architecture**:
  - **Form & Validation Errors**: Highlight offending inputs, explain precise formatting or boundary violations (e.g. GSTIN regex, missing line items, invalid phone numbers), and provide correction examples.
  - **Network & API Connectivity**: Clarify whether the network is offline or the backend service is unreachable, display retry countdowns/actions, and activate graceful local-cache fallback indicators.
  - **Database & Sync Failures**: Indicate whether PostgreSQL synchronization failed, explain temporary operational mode (e.g., local state active), and provide a direct "Retry Sync" action.
  - **Authentication & Permissions**: Provide explicit guidance for session timeouts, invalid credentials, or unauthorized role access with direct navigation to login or role-selection screens.
  - **Business Logic & Workflow Constraints**: Detail exactly why an operation cannot proceed (e.g., budget exceeded, deadline expired, minimum vendor quote requirement unmet) and outline the specific remediation steps required.

---

## 17. Strict Input Schema Validation Standard
- **Centralized Schema Definition in Constants**: All input validation schemas for user and system inputs (frontend forms, API routes, controller bodies, query parameters, and headers) **MUST** be defined in dedicated constants/schema modules (`backend/src/config/validationSchemas.js` and `frontend/lib/validationSchemas.ts`) rather than being declared inline.
- **Single Source of Truth**: Schemas in constants modules serve as the single source of truth for field types, boundaries, regular expressions, and mandatory constraint rules across all project layers.
- **Mandatory Validation Gate on Code Changes**: Whenever making changes that touch user or system inputs:
  1. Define or update the corresponding schema in the dedicated constants module.
  2. Enforce schema validation on incoming payloads, query parameters, and headers at the entry boundary before executing downstream business logic or database operations.
  3. Reject invalid inputs with structured, descriptive validation errors detailing the exact offending fields and formatting requirements.

---

## 18. Dedicated Separate Constants Standard
- **Centralized Constants Modules**: Keep all constants, configuration values, enum mappings, taxonomy dictionaries, and UI strings strictly separated in dedicated constants files:
  - Backend: `backend/src/config/constants.js` and `backend/src/config/validationSchemas.js`
  - Frontend: `frontend/lib/constants.ts`, `frontend/lib/uiStrings.ts`, and `frontend/lib/validationSchemas.ts`
- **Zero Hardcoded Constants**: Eliminate all magic numbers, hardcoded URLs, and inline literals across application controllers, models, React components, and services.

---

## 19. Dedicated Separate Types & Interfaces Standard
- **Centralized Type Definitions**: All domain data models, payload types, state interfaces, and API response contracts **MUST** reside in dedicated type definition files:
  - Frontend: `frontend/lib/types.ts`
  - Backend: `backend/src/config/types.js` (or JSDoc typedef declarations)
- **Zero Inline Type Declarations**: Prohibit inline interface/type definitions in pages, components, or routes. Use `import type` for explicit, isolated type imports.

---

## 20. Strictest Linter & Code Quality Standard
- **A. Strong Typing and Error Prevention**:
  - Enforce `@typescript-eslint/no-explicit-any` (disallow any), `@typescript-eslint/no-non-null-assertion` (disallow `!`), `@typescript-eslint/consistent-type-imports` (enforce `import type`), and `@typescript-eslint/prefer-optional-chain`.
  - Enforce `@typescript-eslint/no-unused-vars` and `@typescript-eslint/naming-convention` (PascalCase for types/interfaces, camelCase for variables/functions).
- **B. React & Next.js Rules**:
  - Enforce React hooks rules (`react-hooks/rules-of-hooks`, `react-hooks/exhaustive-deps`), secure rendering practices, and consistent boolean property handling.
  - Enforce accessibility rules via `jsx-a11y` (`jsx-a11y/alt-text`, `jsx-a11y/no-redundant-roles`, `jsx-a11y/anchor-is-valid`).
- **C. General Code Quality, Style & Formatting**:
  - ES6+ formatting: Enforce single quotes (`quotes: ['error', 'single']`), semicolons (`semi: ['error', 'always']`), `prefer-const`, `no-var`, `object-shorthand`, and `comma-dangle`.
  - Maintainability: Enforce modular files, clean function structure, and UI string separation via `frontend/lib/uiStrings.ts`.
  - Continuous Gate: Linter verification (`npm run lint`) is strictly integrated into primary build and CI/CD workflows, blocking any merges with warnings or errors.

---

## 21. Pre-Commit Quality Gate & Git Hooks Protocol
- **Mandatory Pre-Commit Verification**: All git commits **MUST** pass automated pre-commit hook checks (`.husky/pre-commit` or `.git/hooks/pre-commit`) before being recorded in git history.
- **Pre-Commit Execution Sequence**:
  1. **Linting & Code Style**: Run `npm run lint` to enforce zero ESLint warnings and errors.
  2. **TypeScript Static Typecheck**: Run `npm run typecheck` (`tsc --noEmit`) to ensure zero type errors.
  3. **Unit Tests & 90% Per-File Code Coverage**: Run `npm run test:coverage` and `npm run check:coverage` enforcing $\ge 90\%$ on Statements, Branches, Functions, and Lines.
  4. **Production Build & Asset Verification**: Run `npm run build` to confirm clean compilation and prerendering.
- **Fail-Safe Gate**: If any test fails, coverage falls below 90% on any file, or linter/typecheck reports warnings/errors, the commit operation is automatically aborted.
- **Workspace Pre-Commit Command**:
  ```bash
  npm run pre-commit
  ```

---

## 22. Strict Declarative UI & Prohibition of Direct DOM Manipulation Standard
- **Prohibition of Low-Level DOM Manipulation**: Strictly prohibit direct DOM manipulation methods (e.g. `document.getElementById`, `document.querySelector`, `element.innerHTML`, `element.appendChild`, `element.removeChild`, `element.style.*`, jQuery, or low-level DOM mutation libraries) within application code.
- **Framework State as Single Source of Truth**: All UI updates, animations, class changes, visibility toggles, and modal states **MUST** be driven declaratively through React state (`useState`, `useReducer`, Context API, Zustand/store) or standard CSS classes.
- **Virtual DOM Integrity**: Preserving declarative state management guarantees that React's view engine remains the single source of truth, preventing virtual DOM desynchronization, layout thrashing, memory leaks, and hydration mismatch errors.

---

## 23. i18n Language Internationalization & Centralized UI Strings Standard
- **Centralized `UI_STRINGS` Dictionary**: All user-facing literal strings, screen titles, headings, action button labels, badge texts, modal descriptions, and notification messages **MUST** reside in dedicated constants modules (`frontend/lib/uiStrings.ts` and `backend/src/config/constants.js`) and be referenced via a centralized `UI_STRINGS` object.
- **Zero Hardcoded User-Facing Literals**: Prohibit embedding raw user-facing literal strings directly in JSX/TSX components, store actions, or handlers.
- **Dynamic Template Placeholders & Interpolation**: Use template placeholders (e.g. `{param}`) and interpolation helper functions (`formatString(template, values)`) for runtime parameter substitution, ensuring the entire application is fully i18n-ready.
- **Robust Constant-Driven Test Assertions**: All frontend unit tests **MUST** assert against `UI_STRINGS` constants rather than brittle hardcoded strings to guarantee test resiliency against copy and locale adjustments.
