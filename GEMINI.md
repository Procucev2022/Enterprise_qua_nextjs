# Antigravity & Gemini Agent Guidelines

## 1. Mandatory Unit Testing & Coverage Rules
- **Benchmark**: Achieve and maintain **>= 90% Unit Test Coverage per file** on Lines, Statements, Branches, and Functions across all code files in `frontend/` and `backend/`.
- **Global Timeout**: 20,000 ms.
- **Verification Command**:
  ```bash
  npm run test:coverage
  npm run check:coverage
  ```
- **Strict Error Enforcement**: If any single file falls below 90% in statements, branches, functions, or lines, the coverage verifier script will exit with error code 1.
- **AI Agent Obligation**: Before concluding any task or reporting completion to the user, run `npm run test:coverage` and ensure 0 failures and 90%+ coverage on every single file.

---

## 2. User Prompt History Maintenance (`prompts.md`)
- Maintain a file in the workspace root named `prompts.md`.
- **Strict Requirement**: Save **ONLY** user-provided prompts in `prompts.md`. Do **NOT** include AI-generated conversational output.
- Update `prompts.md` whenever new user prompts are provided.

---

## 3. Logs Storage & Detailed Application Logging
- **Centralized Structured Logging**: Persist logs in local file system under `backend/logs/` (`app.log`, `error.log`, `audit.log`) with automatic purging policies and searchability.
- **Detailed Logs**: Log detailed contextual information (actions, parameters, state changes, errors) across backend controllers, services, database middleware, and frontend store actions.

---

## 4. Database Optimization & Query Efficiency Standard
- **Query Auditing**: Continuously audit database queries to ensure indexing, prevent full table scans, and log slow queries with execution timings.
- **Compute Hours & Resource Minimization**: Utilize intelligent query caching (TTL/LRU) to eliminate redundant compute load and tune connection pooling to promptly reclaim idle connections.

---

## 5. GraphQL Integration & Streamlined Fetching
- Provide a robust `/graphql` interface to enable fine-grained field selection, batched fetching, and prevent over-fetching across all enterprise domains.

---

## 6. Tech Stack LTS/Stable Version Upgrade & Dependency Maintenance Protocol
- Regularly audit, upgrade, and maintain all runtime environments, frameworks, dependencies, and libraries to their latest Long-Term Support (LTS) or stable releases.
- Systematically refactor breaking changes, deprecation warnings, and API updates.
- Verify stability and backward compatibility via full unit tests, linting, typecheck, and coverage verification.

---

## 7. Auto-Resolve Bugs & Errors in Logs Standard
- Continuously monitor, parse, and analyze runtime log outputs, stack traces, and error codes in log files (`app.log`, `error.log`, `audit.log`) to diagnose root causes and implement verified fixes.
- Enforce full test suite, linting, and coverage verification on all bug fixes to prevent regressions.

---

## 8. Auto-Resolve Warnings Standard
- Proactively detect and resolve all compiler, linter, runtime, React hook, and dependency warnings across the entire repository.
- Apply safe refactoring for deprecation notices, unused imports, type mismatches, and syntax warnings without disrupting core behavior.

---

## 9. Automated Performance Optimization Standard
- Continuously profile and optimize critical paths, API payloads, database query latency, code-splitting, lazy-loading, and multi-tier resource caching.
- Validate improvements against bundle size, load time, and compute consumption benchmarks.

---

## 10. Quality Check Pipeline & Multi-Project Verification Protocol
- **Sequence**: Build and Unit Test Coverage MUST be verified first, followed by TypeScript Typecheck, Linting, and Database Migrations.
- **Global Workspace Commands**:
  - `npm run check:quality` or `npm run qc`: Full workspace quality check pipeline.
  - `npm run check:fast` or `npm run qc:fast`: Fast incremental check for active changes.

---

## 11. CI/CD Quality Gate & Pull Request Reporting Protocol
- CI/CD workflow (`.github/workflows/ci.yml`) runs on PRs and pushes to enforce linting, build, typecheck, migrations, and strict per-file 90% unit test coverage.
- Automatically generates and posts detailed PR summary comments with test failure/success stats, suite metrics, and per-file coverage tables.

---

## 12. Environment Variables Example & Secrets Sanitation Standard
- Maintain `.env.example`, `backend/.env.example`, and `frontend/.env.example` with all configuration variables without exposing secrets or credentials.
- Read all configurable parameters from `process.env` with safe default fallbacks.

---

## 13. Comprehensive and Descriptive UI Error Messaging Standard
- Implement user-facing error messages with specific failure details, clear context, and actionable resolution steps across all error categories (Form Validation, Network Failures, Database/Sync, Authentication, and Business Logic constraints).

---

## 14. Strict Input Schema Validation Standard
- Define all input validation schemas in dedicated constants modules (`backend/src/config/validationSchemas.js` and `frontend/lib/validationSchemas.ts`) as a single source of truth.
- Validate all user and system inputs (forms, API routes, controller bodies, query params, headers) against schema constants before executing business logic.
