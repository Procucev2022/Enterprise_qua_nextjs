# GitHub Copilot & Codex Instructions

## Mandatory Unit Testing & Coverage Benchmark
1. Every file in `app/` and `lib/` must have high-quality unit tests in `__tests__/`.
2. Coverage must meet or exceed **90% across Lines, Statements, Branches, and Functions** for every file.
3. Always verify changes using `npm run test:coverage`.
4. Tests must complete within the 20,000ms global timeout.
5. All GitHub Actions CI/CD workflows and jobs must define explicit timeouts (`timeout-minutes`) to prevent runner hanging and resource exhaustion.

