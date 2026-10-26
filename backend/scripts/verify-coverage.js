const path = require('path');
const { runCoverageCheck } = require('../../scripts/coverage-policy.cjs');

runCoverageCheck(path.resolve(__dirname, '..'), 'backend');
