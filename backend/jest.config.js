module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js'],
  // Severs the real MySQL connection before every suite. A test that forgot to
  // double the query layer previously wrote fixture RFQs into the live shared
  // schema; now it fails loudly instead. See __tests__/setup/noRealDatabase.js.
  setupFilesAfterEnv: ['<rootDir>/__tests__/setup/noRealDatabase.js'],
  testTimeout: 20000,
  setupFiles: ['<rootDir>/jest.setup.js'],
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/public/**',
    '!src/db/schema.sql',
    '!src/config/categories.json',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'text-summary', 'lcov', 'json', 'json-summary', 'clover'],
  coverageThreshold: {
    global: {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90,
    },
  },
};
