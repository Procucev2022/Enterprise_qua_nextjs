module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js'],
  testTimeout: 20000,
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/public/**',
    '!src/db/schema.sql',
    '!src/config/categories.json',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'text-summary', 'lcov', 'json'],
};
