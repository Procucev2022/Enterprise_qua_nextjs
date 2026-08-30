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
