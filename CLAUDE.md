# Claude Coding Guidelines & Testing Standards

## Testing Commands
- Run all tests: `npm test`
- Run tests with coverage and check 90% benchmark: `npm run test:coverage`
- Run coverage checker independently: `npm run check:coverage`
- Watch mode: `npm run test:watch`

## Strict Testing Architecture & Coverage Requirements
- **Framework**: Jest with `@testing-library/react` and Next.js SWC transforms.
- **Coverage Target**: At least **90% coverage on every single file** for lines, statements, branches, and functions.
- **Timeout**: Global timeout is configured to 20,000ms.
- **Rules for changes**:
  1. Whenever editing or writing code, update or add unit tests in `__tests__/`.
  2. Always execute `npm run test:coverage` to confirm that all tests pass and that coverage for every touched and existing file remains >= 90%.
  3. Never skip any application file.
