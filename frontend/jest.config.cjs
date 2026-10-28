const nextJest = require('next/jest');
const { COVERAGE_THRESHOLDS } = require('../scripts/coverage-policy.cjs');

const createJestConfig = nextJest({
  dir: './',
});

/** @type {import('jest').Config} */
const customJestConfig = {
  setupFiles: ['<rootDir>/jest.polyfills.js'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testEnvironment: 'jest-environment-jsdom',
  testTimeout: 20000,
  forceExit: true,
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  testMatch: [
    '**/__tests__/**/*.[jt]s?(x)',
    '**/?(*.)+(spec|test).[jt]s?(x)',
  ],
  collectCoverageFrom: [
    'app/**/*.{js,jsx,ts,tsx}',
    'lib/**/*.{js,jsx,ts,tsx}',
    '!**/*.d.ts',
    '!**/node_modules/**',
  ],
  coverageReporters: ['json', 'json-summary', 'lcov', 'text-summary'],
  coverageThreshold: {
    global: COVERAGE_THRESHOLDS,
    './app/**/*.{js,jsx,ts,tsx}': COVERAGE_THRESHOLDS,
    './lib/**/*.{js,jsx,ts,tsx}': COVERAGE_THRESHOLDS,
  },
};

module.exports = createJestConfig(customJestConfig);
