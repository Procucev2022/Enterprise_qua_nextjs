const { COVERAGE_THRESHOLDS } = require('../scripts/coverage-policy.cjs');

module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js', '**/__tests__/**/*.test.mjs'],
  // Severs the real PostgreSQL connection before every suite. A test that forgot
  // to double the query layer previously wrote fixture records into the live
  // database; now it fails loudly instead. See __tests__/setup/noRealDatabase.js.
  setupFilesAfterEnv: ['<rootDir>/__tests__/setup/noRealDatabase.js'],
  testTimeout: 20000,
  moduleNameMapper: {
    '^cloudflare:node$': '<rootDir>/__tests__/fixtures/cloudflareNode.mjs',
    '^cloudflare:workers$': '<rootDir>/__tests__/fixtures/cloudflareWorkers.mjs',
  },
  setupFiles: ['<rootDir>/jest.setup.js'],
  collectCoverageFrom: [
    'src/**/*.{js,mjs}',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'text-summary', 'lcov', 'json', 'json-summary', 'clover'],
  coverageThreshold: {
    global: COVERAGE_THRESHOLDS,
    './src/**/*.{js,mjs}': COVERAGE_THRESHOLDS,
  },
};
