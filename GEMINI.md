# Antigravity & Gemini Agent Guidelines

## Mandatory Unit Testing & Coverage Rules
- **Benchmark**: Achieve and maintain **>= 90% Unit Test Coverage per file** on Lines, Statements, Branches, and Functions across all code files in `app/` and `lib/`.
- **Global Timeout**: 20,000 ms.
- **Verification Command**:
  ```bash
  npm run test:coverage
  ```
- **Strict Error Enforcement**: If any single file falls below 90% in statements, branches, functions, or lines, the coverage verifier script (`scripts/verify-coverage.js`) will exit with error code 1.
- **AI Agent Obligation**: Before concluding any task or reporting completion to the user, run `npm run test:coverage` and ensure 0 failures and 90%+ coverage on every single file.
